/**
 * Pure signing code for HMAC-signed HITL confirmation tokens.
 *
 * A preview mints a self-verifying token that any replica holding the same key can verify on the
 * confirm call, so a preview→confirm pair no longer needs replica affinity or a shared store. Nothing
 * in the token is secret and nothing is stored when it is minted.
 *
 * Token format (five dot-separated fields, ~100 chars, safe to paste into a tool argument):
 *
 *   v1.<expiresAtMs>.<tokenId>.<preState>.<mac>
 *
 * - `v1`          literal version.
 * - `expiresAtMs` decimal epoch milliseconds.
 * - `tokenId`     16 random bytes, base64url (22 chars). Makes each preview distinct; replay-cache key.
 * - `preState`    first 8 bytes of HMAC-SHA256(key, PRE_STATE_LABEL || state), base64url (11 chars).
 *                 KEYED, not a plain hash: many states are low-entropy (update-user's site role is
 *                 one of 7 values), so an unkeyed hash would let anyone holding a token recover the
 *                 target's state by hashing the candidates. With the key it reveals nothing. The
 *                 label separates it from the MAC input (a JSON array, which starts with '[').
 * - `mac`         HMAC-SHA256 (32 bytes, base64url, 43 chars) over the JSON array
 *                 `['v1', siteId, userLuid, tool, targetId, binding, preState, expiresAtMs, tokenId]`.
 *                 A JSON array, so a delimiter inside one field can never shift into the next.
 *
 * `siteId`, `userLuid`, `tool`, `targetId`, `binding` and `state` are always supplied by the server
 * from the authenticated request and the live target at verify time — never read from the token.
 *
 * VERIFY ORDER (security decision): malformed → expired → bad-mac → state-changed → ok.
 * - Shape and expiry checks look only at attacker-supplied bytes, so reporting them leaks nothing.
 * - The MAC is checked over the token's OWN `preState` field (not the live one) BEFORE comparing it
 *   with the live pre-state, which is computed with the SAME key that verified the MAC (current or,
 *   during rotation, previous) — a previous-key token's preState was keyed with the previous key. So `state-changed` is only ever reported for an authentic token minted by
 *   this server for exactly these bound fields: a forged or tampered token always gets `bad-mac`, and
 *   the confirm endpoint can never be used as an oracle for "does the target's current state hash to
 *   X". Success requires BOTH a valid MAC and an unchanged pre-state.
 *
 * No imports from tool code: keys are passed to the constructor, so a test can build two instances
 * from one secret to stand in for two replicas.
 */
import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

export const CONFIRMATION_TOKEN_VERSION = 'v1';
/** HKDF `info` for the confirmation-token key. A different `info` gives another use its own key. */
export const CONFIRMATION_TOKEN_HKDF_INFO = 'tableau-mcp/hitl-confirmation/v1';
/**
 * HKDF `info` for the MCP-Apps approval-token key. A separate key means a model-visible confirmation
 * token can never be replayed as an in-iframe approval (or the reverse), even for the same target.
 */
export const APP_APPROVAL_TOKEN_HKDF_INFO = 'tableau-mcp/hitl-app-approval/v1';

const KEY_BYTES = 32;
const TOKEN_ID_BYTES = 16;
const PRE_STATE_BYTES = 8;
// Domain-separation prefix for the keyed pre-state (see module comment). NUL-terminated.
const PRE_STATE_LABEL = 'tableau-mcp/pre-state/v1\u0000';
const MAC_BYTES = 32;
// Upper bound on accepted token length; a real token is ~100 chars. Rejects absurd inputs cheaply.
const MAX_TOKEN_LENGTH = 256;
// 1-16 decimal digits, no leading zero / sign / exponent / whitespace.
const EXPIRES_AT_PATTERN = /^[1-9][0-9]{0,15}$/;

/** Server-supplied fields a token is bound to. None of them are read from the token itself. */
export interface TokenFields {
  siteId: string;
  userLuid: string;
  tool: string;
  targetId: string;
  /** Fingerprint of the caller-controlled parameters ('' when the tool has none). */
  binding: string;
  /** The target's state string at preview time / live at confirm time ('' when none). */
  state: string;
}

export type VerifyFailureReason = 'malformed' | 'expired' | 'state-changed' | 'bad-mac';

export type VerifyResult =
  { ok: true; tokenId: string; expiresAtMs: number } | { ok: false; reason: VerifyFailureReason };

/** The fields the MAC covers. `state` is not needed: the MAC is over the token's OWN preState. */
export type BoundTokenFields = Omit<TokenFields, 'state'>;

/**
 * A token whose shape, expiry and MAC have been checked (authenticate()), awaiting the pre-state
 * comparison (checkPreState()). Opaque to callers; only the codec that produced it can use it.
 */
export interface AuthenticatedToken {
  readonly tokenId: string;
  readonly expiresAtMs: number;
  /** @internal */
  readonly preState: string;
  /** @internal The key (current or previous) that verified the MAC; also keyed the preState. */
  readonly verifyingKey: Buffer;
}

export type AuthenticateResult =
  | { ok: true; token: AuthenticatedToken }
  | { ok: false; reason: Exclude<VerifyFailureReason, 'state-changed'> };

export interface ConfirmationTokenKeys {
  /** Signs new tokens and verifies. */
  current: Buffer;
  /** Verify-only, set during secret rotation. */
  previous?: Buffer;
}

/**
 * Derives a 32-byte signing key: HKDF-SHA256(secret, salt = empty, info). `info` defaults to the
 * confirmation-token label; pass APP_APPROVAL_TOKEN_HKDF_INFO for the app-approval key.
 */
export function deriveConfirmationTokenKey(
  secret: string,
  info: string = CONFIRMATION_TOKEN_HKDF_INFO,
): Buffer {
  return Buffer.from(
    hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.alloc(0), info, KEY_BYTES),
  );
}

/** A fresh random 32-byte key, for a process with no configured secret. */
export function generateConfirmationTokenKey(): Buffer {
  return randomBytes(KEY_BYTES);
}

/** First 8 bytes of HMAC-SHA256(key, PRE_STATE_LABEL || state), base64url (11 chars). */
export function computePreState(key: Buffer, state: string): string {
  return createHmac('sha256', key)
    .update(PRE_STATE_LABEL + state, 'utf8')
    .digest()
    .subarray(0, PRE_STATE_BYTES)
    .toString('base64url');
}

/**
 * Decodes a base64url field only if it is the canonical (unpadded) encoding of exactly `bytes`
 * bytes. Rejects wrong lengths, foreign characters and non-canonical trailing bits, so no two
 * distinct strings decode to the same field value.
 */
function decodeCanonicalBase64Url(value: string, bytes: number): Buffer | undefined {
  const expectedLength = Math.ceil((bytes * 4) / 3);
  if (value.length !== expectedLength || !/^[A-Za-z0-9_-]+$/.test(value)) {
    return undefined;
  }
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length !== bytes || decoded.toString('base64url') !== value) {
    return undefined;
  }
  return decoded;
}

interface ParsedToken {
  expiresAtMs: number;
  tokenId: string;
  preState: string;
  mac: Buffer;
}

function parseToken(token: unknown): ParsedToken | undefined {
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    return undefined;
  }
  const parts = token.split('.');
  if (parts.length !== 5) {
    return undefined;
  }
  const [version, expiresAtRaw, tokenId, preState, macRaw] = parts;
  if (version !== CONFIRMATION_TOKEN_VERSION || !EXPIRES_AT_PATTERN.test(expiresAtRaw)) {
    return undefined;
  }
  const expiresAtMs = Number(expiresAtRaw);
  if (!Number.isSafeInteger(expiresAtMs)) {
    return undefined;
  }
  const mac = decodeCanonicalBase64Url(macRaw, MAC_BYTES);
  if (
    !decodeCanonicalBase64Url(tokenId, TOKEN_ID_BYTES) ||
    !decodeCanonicalBase64Url(preState, PRE_STATE_BYTES) ||
    !mac
  ) {
    return undefined;
  }
  return { expiresAtMs, tokenId, preState, mac };
}

/**
 * Cheap shape check (no key, no clock): true when `token` parses as a v1 token. Lets a caller reject
 * an empty or garbage token before doing any work (e.g. REST lookups for the live pre-state). A
 * well-formed token can still fail verify (expired, bad MAC, state changed).
 */
export function isWellFormedConfirmationToken(token: unknown): token is string {
  return parseToken(token) !== undefined;
}

function assertKey(key: Buffer, name: string): void {
  if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES) {
    throw new Error(`Confirmation token ${name} key must be ${KEY_BYTES} bytes`);
  }
}

export class ConfirmationTokenCodec {
  private readonly current: Buffer;
  private readonly previous?: Buffer;
  private readonly now: () => number;

  constructor(keys: ConfirmationTokenKeys, now: () => number = Date.now) {
    assertKey(keys.current, 'current');
    if (keys.previous !== undefined) {
      assertKey(keys.previous, 'previous');
    }
    this.current = keys.current;
    this.previous = keys.previous;
    this.now = now;
  }

  /** Mints a token bound to `fields`, valid for `ttlMs` from now. Stores nothing. */
  mint(fields: TokenFields, ttlMs: number): string {
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
      throw new Error('Confirmation token TTL must be a positive integer number of milliseconds');
    }
    const expiresAtMs = this.now() + ttlMs;
    const tokenId = randomBytes(TOKEN_ID_BYTES).toString('base64url');
    const preState = computePreState(this.current, fields.state);
    const mac = sign(this.current, fields, preState, expiresAtMs, tokenId).toString('base64url');
    return [CONFIRMATION_TOKEN_VERSION, String(expiresAtMs), tokenId, preState, mac].join('.');
  }

  /** Verifies `token` against the server-supplied `fields`. See the module comment for the order. */
  verify(token: string, fields: TokenFields): VerifyResult {
    const authenticated = this.authenticate(token, fields);
    if (!authenticated.ok) {
      return authenticated;
    }
    return this.checkPreState(authenticated.token, fields.state);
  }

  /**
   * First half of verify(): shape → expiry → MAC, WITHOUT the live pre-state. The MAC covers the
   * token's own preState field, so this needs no target read. Lets a caller reject a forged,
   * tampered or expired token before doing the REST reads that produce the live pre-state.
   */
  authenticate(token: string, fields: BoundTokenFields): AuthenticateResult {
    const parsed = parseToken(token);
    if (!parsed) {
      return { ok: false, reason: 'malformed' };
    }
    if (this.now() >= parsed.expiresAtMs) {
      return { ok: false, reason: 'expired' };
    }

    // MAC over the token's own preState: proves the token is authentic for these bound fields.
    const keys = this.previous ? [this.current, this.previous] : [this.current];
    let verifyingKey: Buffer | undefined;
    for (const key of keys) {
      const expected = sign(key, fields, parsed.preState, parsed.expiresAtMs, parsed.tokenId);
      // Both buffers are MAC_BYTES long (parseToken enforced it), as timingSafeEqual requires.
      // No early exit: every configured key is always tried.
      if (timingSafeEqual(expected, parsed.mac) && !verifyingKey) {
        verifyingKey = key;
      }
    }
    if (!verifyingKey) {
      return { ok: false, reason: 'bad-mac' };
    }
    return {
      ok: true,
      token: {
        tokenId: parsed.tokenId,
        expiresAtMs: parsed.expiresAtMs,
        preState: parsed.preState,
        verifyingKey,
      },
    };
  }

  /**
   * Second half of verify(): only for an authentic token (from authenticate()), has the live target
   * moved since the preview? Re-checks expiry, since the live-state read may have taken a while.
   */
  checkPreState(token: AuthenticatedToken, state: string): VerifyResult {
    if (this.now() >= token.expiresAtMs) {
      return { ok: false, reason: 'expired' };
    }
    // The token's preState was keyed with the key that minted it, i.e. the one that verified the MAC.
    const livePreState = Buffer.from(computePreState(token.verifyingKey, state), 'utf8');
    if (!timingSafeEqual(livePreState, Buffer.from(token.preState, 'utf8'))) {
      return { ok: false, reason: 'state-changed' };
    }
    return { ok: true, tokenId: token.tokenId, expiresAtMs: token.expiresAtMs };
  }
}

function sign(
  key: Buffer,
  fields: BoundTokenFields,
  preState: string,
  expiresAtMs: number,
  tokenId: string,
): Buffer {
  const input = JSON.stringify([
    CONFIRMATION_TOKEN_VERSION,
    fields.siteId,
    fields.userLuid,
    fields.tool,
    fields.targetId,
    fields.binding,
    preState,
    expiresAtMs,
    tokenId,
  ]);
  return createHmac('sha256', key).update(input, 'utf8').digest();
}
