import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { getConfig } from '../../../config.js';
import { createNamespacedStore } from '../../../sessionStore/init.js';
import { SessionStore } from '../../../sessionStore/sessionStore.js';
import { EvidenceContext, EvidenceStrategy, getMutationPreviewTtlMs } from './evidence.js';
import { MutationTarget } from './mutationGuard.js';

let signingKey: Buffer | null = null;

// Replicas must share the key, so derive it from the OAuth JWE private key they already share. The
// derivation keeps that key from signing anything directly. Without a configured key each process
// signs with its own random key, so preview and confirm must reach the same process.
function getSigningKey(): Buffer {
  if (!signingKey) {
    const { oauth } = getConfig();
    let pem = oauth.jwePrivateKey.replace(/\\n/g, '\n');
    if (!pem && oauth.jwePrivateKeyPath) {
      // A configured but unreadable key must fail, not fall back to a key the other replicas lack.
      pem = readFileSync(oauth.jwePrivateKeyPath, 'utf8');
    }
    if ((oauth.jwePrivateKey || oauth.jwePrivateKeyPath) && !pem.trim()) {
      throw new Error('Configured OAuth JWE private key is empty');
    }
    signingKey = pem
      ? createHmac('sha256', pem).update('mutation-confirmation-token-v1').digest()
      : randomBytes(32);
  }
  return signingKey;
}

let pending: SessionStore<true> | null = null;

function getPending(): SessionStore<true> {
  return (pending ??= createNamespacedStore<true>('flow-mutation-confirmations-v1', {
    ttlMs: getMutationPreviewTtlMs(),
  }));
}

function sign(ctx: EvidenceContext, expiresAtMs: number, nonce: string): string {
  const { siteId, userLuid, tool, target, binding = '' } = ctx;
  // JSON keeps a delimiter inside one field from shifting into the next.
  return createHmac('sha256', getSigningKey())
    .update(JSON.stringify([siteId, userLuid, tool, target.id, binding, expiresAtMs, nonce]))
    .digest('hex');
}

/**
 * Signed preview evidence with atomic single-use consumption through the configured session store.
 * The token is `<expiresAtMs>-<nonce>-<hmac>`; the HMAC covers site, user, tool, target, binding,
 * expiry and nonce. Only its signature is stored, never the raw confirmation token.
 *
 * Replicas need both a shared signing key and a shared session store with atomic consume(). With
 * the memory provider, a confirmation routed to another process is safely rejected.
 */
export class SignedTokenEvidence implements EvidenceStrategy<MutationTarget> {
  private lastNonce?: string;

  async establish(ctx: EvidenceContext): Promise<void> {
    const expiresAtMs = Date.now() + getMutationPreviewTtlMs();
    // Randomness keeps previews in the same millisecond independent, including after consumption.
    const nonce = randomBytes(16).toString('hex');
    const signature = sign(ctx, expiresAtMs, nonce);
    this.lastNonce = undefined;
    await getPending().set(signature, true);
    this.lastNonce = `${expiresAtMs}-${nonce}-${signature}`;
  }

  async verify(ctx: EvidenceContext): Promise<boolean> {
    const [expiry, nonce, signature, ...rest] = (ctx.confirmationToken ?? '').split('-');
    const expiresAtMs = Number(expiry);
    if (
      !/^\d+$/.test(expiry) ||
      !/^[0-9a-f]{32}$/.test(nonce ?? '') ||
      !/^[0-9a-f]{64}$/.test(signature ?? '') ||
      rest.length ||
      !Number.isSafeInteger(expiresAtMs) ||
      expiresAtMs <= Date.now()
    ) {
      return false;
    }

    const expected = Buffer.from(sign(ctx, expiresAtMs, nonce));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      return false;
    }

    // Never recreate a missing entry at confirm time: absent, evicted or consumed proof rejects.
    const consumed = await getPending().consume(signature);
    return consumed === true && expiresAtMs > Date.now();
  }

  describeEvidence(): { kind: 'registry-nonce'; detail?: string } {
    return {
      kind: 'registry-nonce',
      detail: 'signed single-use confirmation token (session store)',
    };
  }

  /** Never audited. */
  getEstablishedNonce(): string | undefined {
    return this.lastNonce;
  }
}
