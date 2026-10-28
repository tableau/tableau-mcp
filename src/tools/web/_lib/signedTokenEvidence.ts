import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { getConfig } from '../../../config.js';
import { ExpiringMap } from '../../../utils/expiringMap.js';
import { EvidenceContext, EvidenceStrategy, getMutationPreviewTtlMs } from './evidence.js';
import { MutationTarget } from './mutationGuard.js';

let signingKey: string | null = null;

// Replicas must share the key, so reuse the OAuth JWE private key they already share. Without OAuth
// there is one process, and a random key is enough.
function getSigningKey(): string {
  if (signingKey === null) {
    signingKey = '';
    try {
      const { oauth } = getConfig();
      signingKey = oauth.jwePrivateKey.replace(/\n/g, '\n');
      if (!signingKey && oauth.jwePrivateKeyPath) {
        signingKey = readFileSync(oauth.jwePrivateKeyPath, 'utf8');
      }
    } catch {
      // No usable OAuth key.
    }
    signingKey ||= randomBytes(32).toString('hex');
  }
  return signingKey;
}

let spent: ExpiringMap<string, true> | null = null;

function getSpent(): ExpiringMap<string, true> {
  return (spent ??= new ExpiringMap<string, true>({
    defaultExpirationTimeMs: getMutationPreviewTtlMs(),
  }));
}

function sign(ctx: EvidenceContext, expiresAtMs: number): string {
  const { siteId, userLuid, tool, target, binding = '' } = ctx;
  return createHmac('sha256', getSigningKey())
    .update(['mutation-confirm', siteId, userLuid, tool, target.id, binding, expiresAtMs].join(':'))
    .digest('hex');
}

/**
 * Drop-in for RegistryEvidence that keeps no state between preview and confirm, so the two calls can
 * hit different replicas. The token is `<expiresAtMs>-<hmac>`; the HMAC covers site, user, tool,
 * target, binding and expiry.
 *
 * A token is single-use per process only. Another replica accepts a replay until it expires.
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
    if (!signature || rest.length || !(expiresAtMs >= Date.now())) {
      return false;
    }

    const expected = Buffer.from(sign(ctx, expiresAtMs));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      return false;
    }

    if (getSpent().has(signature)) {
      return false;
    }
    getSpent().set(signature, true);
    return true;
  }

  describeEvidence(): { kind: 'registry-nonce'; detail?: string } {
    return { kind: 'registry-nonce', detail: 'stateless signed single-use confirmation token' };
  }

  /** Never audited. */
  getEstablishedNonce(): string | undefined {
    return this.lastNonce;
  }
}
