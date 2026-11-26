import { createHash } from 'node:crypto';

import {
  computePreState,
  CONFIRMATION_TOKEN_HKDF_INFO,
  ConfirmationTokenCodec,
  deriveConfirmationTokenKey,
  generateConfirmationTokenKey,
  TokenFields,
} from './confirmationTokenCodec.js';

const SECRET = 'a'.repeat(32) + '-test-secret-one';
const OTHER_SECRET = 'b'.repeat(32) + '-test-secret-two';
const TTL_MS = 5 * 60 * 1000;
const T0 = 1_800_000_000_000;

const FIELDS: TokenFields = {
  siteId: 'site-luid-1',
  userLuid: 'user-luid-1',
  tool: 'update-user',
  targetId: 'target-1',
  binding: 'target-1:Viewer',
  state: 'Creator',
};

const TOKEN_PATTERN = /^v1\.[0-9]+\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{11}\.[A-Za-z0-9_-]{43}$/;

function codecFor(
  secret: string,
  now: () => number = () => T0,
  previous?: string,
): ConfirmationTokenCodec {
  return new ConfirmationTokenCodec(
    {
      current: deriveConfirmationTokenKey(secret),
      previous: previous ? deriveConfirmationTokenKey(previous) : undefined,
    },
    now,
  );
}

/** Replace one character of a field (by index into the 5 dot-separated parts) with another valid one. */
function flipCharInField(token: string, fieldIndex: number, position = 0): string {
  const parts = token.split('.');
  const field = parts[fieldIndex];
  const ch = field[position];
  const replacement = ch === 'A' ? 'B' : fieldIndex === 1 ? (ch === '9' ? '8' : '9') : 'A';
  parts[fieldIndex] = field.slice(0, position) + replacement + field.slice(position + 1);
  return parts.join('.');
}

describe('confirmationTokenCodec', () => {
  describe('key derivation', () => {
    it('derives a deterministic 32-byte key from the secret via HKDF', () => {
      const a = deriveConfirmationTokenKey(SECRET);
      const b = deriveConfirmationTokenKey(SECRET);
      expect(a).toHaveLength(32);
      expect(a.equals(b)).toBe(true);
      expect(a.equals(deriveConfirmationTokenKey(OTHER_SECRET))).toBe(false);
      // The derived key is not the raw secret bytes.
      expect(a.equals(Buffer.from(SECRET, 'utf8').subarray(0, 32))).toBe(false);
      expect(CONFIRMATION_TOKEN_HKDF_INFO).toBe('tableau-mcp/hitl-confirmation/v1');
    });

    it('rejects keys that are not 32 bytes', () => {
      expect(() => new ConfirmationTokenCodec({ current: Buffer.alloc(16) })).toThrow(/32 bytes/);
      expect(
        () =>
          new ConfirmationTokenCodec({
            current: generateConfirmationTokenKey(),
            previous: Buffer.alloc(8),
          }),
      ).toThrow(/32 bytes/);
    });
  });

  describe('mint', () => {
    it('produces v1.<expiresAtMs>.<tokenId:22>.<preState:11>.<mac:43>', () => {
      const token = codecFor(SECRET).mint(FIELDS, TTL_MS);
      expect(token).toMatch(TOKEN_PATTERN);
      const [, expiresAt, , preState] = token.split('.');
      expect(Number(expiresAt)).toBe(T0 + TTL_MS);
      expect(preState).toBe(computePreState(deriveConfirmationTokenKey(SECRET), FIELDS.state));
    });

    it('mints distinct tokens in the same millisecond', () => {
      const codec = codecFor(SECRET);
      const tokens = new Set(Array.from({ length: 50 }, () => codec.mint(FIELDS, TTL_MS)));
      expect(tokens.size).toBe(50);
      const ids = new Set([...tokens].map((t) => t.split('.')[2]));
      expect(ids.size).toBe(50);
    });

    it('rejects a non-positive or non-integer TTL', () => {
      const codec = codecFor(SECRET);
      expect(() => codec.mint(FIELDS, 0)).toThrow();
      expect(() => codec.mint(FIELDS, -1)).toThrow();
      expect(() => codec.mint(FIELDS, 1.5)).toThrow();
    });

    it('does not embed any bound field in the token', () => {
      const token = codecFor(SECRET).mint(FIELDS, TTL_MS);
      for (const value of Object.values(FIELDS)) {
        expect(token).not.toContain(value);
      }
    });
  });

  describe('verify', () => {
    it('accepts a token on the instance that minted it', () => {
      const codec = codecFor(SECRET);
      const token = codec.mint(FIELDS, TTL_MS);
      const result = codec.verify(token, FIELDS);
      expect(result).toEqual({
        ok: true,
        tokenId: token.split('.')[2],
        expiresAtMs: T0 + TTL_MS,
      });
    });

    it('accepts a token on a different instance built from the same secret (cross-replica)', () => {
      const token = codecFor(SECRET).mint(FIELDS, TTL_MS);
      expect(codecFor(SECRET).verify(token, FIELDS).ok).toBe(true);
    });

    it('rejects a token from an instance with a different secret as bad-mac', () => {
      const token = codecFor(SECRET).mint(FIELDS, TTL_MS);
      expect(codecFor(OTHER_SECRET).verify(token, FIELDS)).toEqual({
        ok: false,
        reason: 'bad-mac',
      });
    });

    it('rejects tokens across random per-process keys', () => {
      const a = new ConfirmationTokenCodec({ current: generateConfirmationTokenKey() });
      const b = new ConfirmationTokenCodec({ current: generateConfirmationTokenKey() });
      expect(b.verify(a.mint(FIELDS, TTL_MS), FIELDS)).toEqual({ ok: false, reason: 'bad-mac' });
    });

    it.each(['siteId', 'userLuid', 'tool', 'targetId', 'binding'] as const)(
      'rejects as bad-mac when bound field %s differs',
      (field) => {
        const codec = codecFor(SECRET);
        const token = codec.mint(FIELDS, TTL_MS);
        expect(codec.verify(token, { ...FIELDS, [field]: `${FIELDS[field]}-x` })).toEqual({
          ok: false,
          reason: 'bad-mac',
        });
      },
    );

    it('rejects as state-changed when only the live state differs', () => {
      const codec = codecFor(SECRET);
      const token = codec.mint(FIELDS, TTL_MS);
      expect(codec.verify(token, { ...FIELDS, state: 'Viewer' })).toEqual({
        ok: false,
        reason: 'state-changed',
      });
    });

    it('never reports state-changed for a token whose MAC is bad', () => {
      const token = codecFor(SECRET).mint(FIELDS, TTL_MS);
      // Wrong secret AND changed state: MAC failure wins.
      expect(codecFor(OTHER_SECRET).verify(token, { ...FIELDS, state: 'Viewer' })).toEqual({
        ok: false,
        reason: 'bad-mac',
      });
      // A changed bound field AND changed state: MAC failure wins.
      expect(
        codecFor(SECRET).verify(token, { ...FIELDS, targetId: 'other', state: 'Viewer' }),
      ).toEqual({ ok: false, reason: 'bad-mac' });
      // An attacker rewriting preState to match the live state: MAC failure (preState is signed).
      const parts = token.split('.');
      parts[3] = computePreState(deriveConfirmationTokenKey(SECRET), 'Viewer');
      expect(codecFor(SECRET).verify(parts.join('.'), { ...FIELDS, state: 'Viewer' })).toEqual({
        ok: false,
        reason: 'bad-mac',
      });
    });

    it('treats empty and absent state consistently', () => {
      const codec = codecFor(SECRET);
      const token = codec.mint({ ...FIELDS, state: '' }, TTL_MS);
      expect(codec.verify(token, { ...FIELDS, state: '' }).ok).toBe(true);
      expect(codec.verify(token, FIELDS)).toEqual({ ok: false, reason: 'state-changed' });
    });

    describe('expiry', () => {
      it('accepts just before expiry and rejects at and after expiry', () => {
        let now = T0;
        const codec = codecFor(SECRET, () => now);
        const token = codec.mint(FIELDS, TTL_MS);
        now = T0 + TTL_MS - 1;
        expect(codec.verify(token, FIELDS).ok).toBe(true);
        now = T0 + TTL_MS;
        expect(codec.verify(token, FIELDS)).toEqual({ ok: false, reason: 'expired' });
        now = T0 + TTL_MS + 60_000;
        expect(codec.verify(token, FIELDS)).toEqual({ ok: false, reason: 'expired' });
      });

      it('rejects a token that expired between mint and verify on another replica', () => {
        let now = T0;
        const token = codecFor(SECRET, () => now).mint(FIELDS, 1_000);
        now = T0 + 1_001;
        expect(codecFor(SECRET, () => now).verify(token, FIELDS)).toEqual({
          ok: false,
          reason: 'expired',
        });
      });

      it('reports a tampered expiry as bad-mac (not accepted) while not yet expired', () => {
        const codec = codecFor(SECRET);
        const token = codec.mint(FIELDS, TTL_MS);
        const parts = token.split('.');
        parts[1] = String(Number(parts[1]) + 10 * 60 * 1000);
        expect(codec.verify(parts.join('.'), FIELDS)).toEqual({ ok: false, reason: 'bad-mac' });
      });
    });

    describe('malformed input', () => {
      const codec = codecFor(SECRET);
      const good = codec.mint(FIELDS, TTL_MS);
      const [v, exp, id, pre, mac] = good.split('.');

      it.each([
        ['empty string', ''],
        ['random text', 'not-a-token'],
        ['legacy UUID nonce', '123e4567-e89b-42d3-a456-426614174000'],
        ['four fields', [v, exp, id, pre].join('.')],
        ['six fields', [v, exp, id, pre, mac, 'x'].join('.')],
        ['wrong version', ['v2', exp, id, pre, mac].join('.')],
        ['uppercase version', ['V1', exp, id, pre, mac].join('.')],
        ['non-numeric expiry', [v, 'abc', id, pre, mac].join('.')],
        ['negative expiry', [v, `-${exp}`, id, pre, mac].join('.')],
        ['leading-zero expiry', [v, `0${exp}`, id, pre, mac].join('.')],
        ['exponent expiry', [v, '1e15', id, pre, mac].join('.')],
        ['hex expiry', [v, '0x1', id, pre, mac].join('.')],
        ['huge expiry', [v, '9'.repeat(17), id, pre, mac].join('.')],
        ['short tokenId', [v, exp, id.slice(1), pre, mac].join('.')],
        ['long tokenId', [v, exp, `${id}A`, pre, mac].join('.')],
        ['short preState', [v, exp, id, pre.slice(1), mac].join('.')],
        ['short mac', [v, exp, id, pre, mac.slice(1)].join('.')],
        ['long mac', [v, exp, id, pre, `${mac}A`].join('.')],
        ['padded mac', [v, exp, id, pre, `${mac.slice(0, 42)}=`].join('.')],
        ['standard-base64 char in tokenId', [v, exp, `+${id.slice(1)}`, pre, mac].join('.')],
        ['slash in mac', [v, exp, id, pre, `/${mac.slice(1)}`].join('.')],
        ['whitespace', ` ${good}`],
        ['trailing newline', `${good}\n`],
        ['oversized input', `${good}${'A'.repeat(300)}`],
      ])('rejects %s as malformed', (_label, token) => {
        expect(codec.verify(token, FIELDS)).toEqual({ ok: false, reason: 'malformed' });
      });

      it('rejects a non-canonical base64url encoding (trailing bits set)', () => {
        // tokenId is 16 bytes → 22 chars; the last char carries 4 unused bits. Flip them.
        const lastChar = id[21];
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
        const nonCanonical = alphabet[(alphabet.indexOf(lastChar) & ~0b1111) | 0b0001];
        const tampered = [v, exp, `${id.slice(0, 21)}${nonCanonical}`, pre, mac].join('.');
        expect(codec.verify(tampered, FIELDS)).toEqual({ ok: false, reason: 'malformed' });
      });

      it('rejects a non-string token as malformed', () => {
        expect(codec.verify(undefined as unknown as string, FIELDS)).toEqual({
          ok: false,
          reason: 'malformed',
        });
      });
    });

    describe('tampering', () => {
      it.each([
        ['expiresAtMs', 1],
        ['tokenId', 2],
        ['preState', 3],
        ['mac', 4],
      ] as const)('a flipped character in %s never verifies', (_label, fieldIndex) => {
        const codec = codecFor(SECRET);
        const token = codec.mint(FIELDS, TTL_MS);
        const tampered = flipCharInField(token, fieldIndex);
        expect(tampered).not.toBe(token);
        const result = codec.verify(tampered, FIELDS);
        expect(result.ok).toBe(false);
        // Never mis-reported as a state change.
        expect(result).not.toEqual({ ok: false, reason: 'state-changed' });
      });

      it('a delimiter shift between fields does not verify', () => {
        const codec = codecFor(SECRET);
        const token = codec.mint(FIELDS, TTL_MS);
        const parts = token.split('.');
        // Move one char from tokenId into preState.
        const shifted = [
          parts[0],
          parts[1],
          parts[2].slice(0, -1),
          parts[2].slice(-1) + parts[3],
          parts[4],
        ];
        expect(codec.verify(shifted.join('.'), FIELDS).ok).toBe(false);
      });

      it('field values containing delimiters cannot collide (JSON-array MAC input)', () => {
        const codec = codecFor(SECRET);
        const token = codec.mint({ ...FIELDS, siteId: 'a', userLuid: 'b.c' }, TTL_MS);
        expect(codec.verify(token, { ...FIELDS, siteId: 'a.b', userLuid: 'c' })).toEqual({
          ok: false,
          reason: 'bad-mac',
        });
        const token2 = codec.mint({ ...FIELDS, siteId: 'a","b' }, TTL_MS);
        expect(
          codec.verify(token2, { ...FIELDS, siteId: 'a', userLuid: `b","${FIELDS.userLuid}` }),
        ).toEqual({ ok: false, reason: 'bad-mac' });
      });
    });

    describe('key rotation', () => {
      it('verifies a token signed with the previous key while minting with the current key', () => {
        const oldReplica = codecFor(OTHER_SECRET);
        const oldToken = oldReplica.mint(FIELDS, TTL_MS);

        const rotated = codecFor(SECRET, () => T0, OTHER_SECRET);
        expect(rotated.verify(oldToken, FIELDS).ok).toBe(true);

        const newToken = rotated.mint(FIELDS, TTL_MS);
        // New tokens are signed with the current key: a replica with only the current key verifies
        // them, a replica with only the old key does not.
        expect(codecFor(SECRET).verify(newToken, FIELDS).ok).toBe(true);
        expect(oldReplica.verify(newToken, FIELDS)).toEqual({ ok: false, reason: 'bad-mac' });
      });

      it('rejects a previous-key token once the previous key is removed', () => {
        const oldToken = codecFor(OTHER_SECRET).mint(FIELDS, TTL_MS);
        expect(codecFor(SECRET).verify(oldToken, FIELDS)).toEqual({ ok: false, reason: 'bad-mac' });
      });

      it('computes the live preState with the key that verified the MAC (previous during rotation)', () => {
        // The old token's preState was keyed with the OLD key; a rotated replica must compare using
        // that key, or every previous-key token would spuriously report state-changed.
        const oldToken = codecFor(OTHER_SECRET).mint(FIELDS, TTL_MS);
        expect(oldToken.split('.')[3]).toBe(
          computePreState(deriveConfirmationTokenKey(OTHER_SECRET), FIELDS.state),
        );
        expect(oldToken.split('.')[3]).not.toBe(
          computePreState(deriveConfirmationTokenKey(SECRET), FIELDS.state),
        );
        expect(codecFor(SECRET, () => T0, OTHER_SECRET).verify(oldToken, FIELDS).ok).toBe(true);
        // A current-key token on the rotated replica also verifies (keyed with the current key).
        const rotated = codecFor(SECRET, () => T0, OTHER_SECRET);
        expect(rotated.verify(rotated.mint(FIELDS, TTL_MS), FIELDS).ok).toBe(true);
      });

      it('reports state-changed for a previous-key token whose state moved', () => {
        const oldToken = codecFor(OTHER_SECRET).mint(FIELDS, TTL_MS);
        expect(
          codecFor(SECRET, () => T0, OTHER_SECRET).verify(oldToken, { ...FIELDS, state: 'x' }),
        ).toEqual({ ok: false, reason: 'state-changed' });
      });
    });
  });

  describe('computePreState', () => {
    const KEY = deriveConfirmationTokenKey(SECRET);
    const OTHER_KEY = deriveConfirmationTokenKey(OTHER_SECRET);

    it('is 11 base64url chars, deterministic, and differs for different states', () => {
      expect(computePreState(KEY, 'Creator')).toMatch(/^[A-Za-z0-9_-]{11}$/);
      expect(computePreState(KEY, 'Creator')).toBe(computePreState(KEY, 'Creator'));
      expect(computePreState(KEY, 'Creator')).not.toBe(computePreState(KEY, 'Viewer'));
      expect(computePreState(KEY, '')).toMatch(/^[A-Za-z0-9_-]{11}$/);
    });

    it('is keyed: a different key gives a different preState for the same state', () => {
      expect(computePreState(KEY, 'Creator')).not.toBe(computePreState(OTHER_KEY, 'Creator'));
    });

    it('is not the plain SHA-256 truncation (the token reveals nothing about a low-entropy state)', () => {
      const siteRoles = [
        'Creator',
        'Explorer',
        'ExplorerCanPublish',
        'SiteAdministratorExplorer',
        'SiteAdministratorCreator',
        'Unlicensed',
        'Viewer',
      ];
      const token = codecFor(SECRET).mint({ ...FIELDS, state: 'Viewer' }, TTL_MS);
      const tokenPreState = token.split('.')[3];
      // Hashing every candidate without the key never reproduces the token's preState field.
      for (const role of siteRoles) {
        const unkeyed = createHash('sha256')
          .update(role, 'utf8')
          .digest()
          .subarray(0, 8)
          .toString('base64url');
        expect(unkeyed).not.toBe(tokenPreState);
      }
    });
  });
});
