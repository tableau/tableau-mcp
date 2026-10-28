import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { getConfig } from '../../../config.js';
import { ExpiringMap } from '../../../utils/expiringMap.js';
import { EvidenceContext, EvidenceStrategy, getMutationPreviewTtlMs } from './evidence.js';
import { MutationTarget } from './mutationGuard.js';

// Key for the HMAC. Every replica must derive the SAME key, so it comes from the OAuth JWE private key
// the hosts already share (a bearer token minted by one host must decrypt on another). Without OAuth
// (stdio / PAT) there is only one process, so a random per-process secret is enough.
let signingKey: Buffer | null = null;

function getSigningKey(): Buffer {
  if (!signingKey) {
    let pem = '';
    try {
      const { oauth } = getConfig();
      pem = oauth.jwePrivateKey.replace(/\n/g, '\n');
      if (!pem && oauth.jwePrivateKeyPath) {
        pem = readFileSync(oauth.jwePrivateKeyPath, 'utf8');
      }
    } catch {
      // No usable OAuth key — fall through to the per-process secret.
    }
    signingKey = pem
      ? createHash('sha256').update(`mutation-confirmation-token-v1\n${pem}`).digest()
      : randomBytes(32);
  }
  return signingKey;
}

// Replay guard. The signature alone is valid for the whole TTL; remembering spent signatures makes a
// token single-use per process. Across replicas a replay is still possible inside the TTL.
let spent: ExpiringMap<string, true> | null = null;

function getSpent(): ExpiringMap<string, true> {
  return (spent ??= new ExpiringMap<string, true>({
    defaultExpirationTimeMs: getMutationPreviewTtlMs(),
  }));
}

function sign(ctx: EvidenceContext, expiresAtMs: number): string {
  const canonical = [
    ctx.siteId,
    ctx.userLuid,
    ctx.tool,
    ctx.target.id,
    ctx.binding ?? '',
    expiresAtMs,
  ].join(':');
  return createHmac('sha256', getSigningKey()).update(canonical).digest('hex');
}

/**
 * SignedTokenEvidence — a drop-in, stateless replacement for RegistryEvidence.
 *
 * `establish` mints `<expiresAtMs>-<hmac>` where the HMAC covers site + user + tool + target +
 * binding + expiry; `verify` recomputes it. Nothing is stored between preview and confirm, so the
 * two calls may land on different replicas or straddle a restart. Same API as RegistryEvidence
 * (`getEstablishedNonce`), so adopting it in a tool is a one-line swap of the constructor.
 *
 * Like every strategy it can only reject, never wrongly allow: forging a token needs the shared key.
 */
export class SignedTokenEvidence implements EvidenceStrategy<MutationTarget> {
  private lastNonce?: string;

  async establish(ctx: EvidenceContext): Promise<void> {
    const expiresAtMs = Date.now() + getMutationPreviewTtlMs();
    this.lastNonce = `${expiresAtMs}-${sign(ctx, expiresAtMs)}`;
  }

  async verify(ctx: EvidenceContext): Promise<boolean> {
    const [expiry, signature, ...rest] = (ctx.confirmationToken ?? '').split('-');
    const expiresAtMs = Number(expiry);
    if (
      !signature ||
      rest.length > 0 ||
      !Number.isFinite(expiresAtMs) ||
      expiresAtMs < Date.now()
    ) {
      return false;
    }

    const expected = Buffer.from(sign(ctx, expiresAtMs));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      return false;
    }

    // Single-use: refuse a signature we've already accepted.
    if (getSpent().has(signature)) {
      return false;
    }
    getSpent().set(signature, true);
    return true;
  }

  describeEvidence(): { kind: 'registry-nonce'; detail?: string } {
    return { kind: 'registry-nonce', detail: 'stateless signed single-use confirmation token' };
  }

  /** The token minted by the last establish(), for the preview response text. Never audited. */
  getEstablishedNonce(): string | undefined {
    return this.lastNonce;
  }
}
