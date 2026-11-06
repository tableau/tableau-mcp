import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { getConfig } from '../../../config.js';
import { EvidenceStoreUnavailableError } from '../../../errors/mcpToolError.js';
import { log } from '../../../logging/logger.js';
import { createNamespacedStore } from '../../../sessionStore/init.js';
import { SessionStore } from '../../../sessionStore/sessionStore.js';
import { EvidenceContext, EvidenceStrategy, getMutationPreviewTtlMs } from './evidence.js';
import { MutationTarget } from './mutationGuard.js';

let signingKey: Buffer | null = null;

// The store entry is what proves a preview ran; the signature only lets a forged or mismatched token
// be rejected before the store is touched. So replicas need the same key, but it need not be secret.
// Derive it from the OAuth JWE private key when one is configured, and otherwise from a fixed label,
// so deployments without embedded OAuth still confirm across replicas.
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
    signingKey = createHmac('sha256', pem || 'tableau-mcp')
      .update('mutation-confirmation-token-v1')
      .digest();
  }
  return signingKey;
}

let pending: SessionStore<string> | null = null;

function getPending(): SessionStore<string> {
  return (pending ??= createNamespacedStore<string>('flow-mutation-confirmations-v1', {
    ttlMs: getMutationPreviewTtlMs(),
  }));
}

// One pending preview per scope, so a new preview replaces the last and one approval means one run.
function scopeKey({ siteId, userLuid, tool, target, binding = '' }: EvidenceContext): string {
  return createHash('sha256')
    .update(JSON.stringify([siteId, userLuid, tool, target.id, binding]))
    .digest('hex');
}

// Store failures surface as a fixed message so backend details (hosts, ports) never reach a client.
async function withStore<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    log({
      message: 'Flow confirmation store operation failed',
      level: 'error',
      logger: 'mutation-guard',
      data: error,
    });
    throw new EvidenceStoreUnavailableError();
  }
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
 * expiry and nonce. Only its signature is stored, never the raw confirmation token, and only the
 * latest preview of a given request can be confirmed.
 *
 * Replicas need a shared session store with atomic consume(). With the memory provider, a
 * confirmation routed to another process is safely rejected.
 */
export class SignedTokenEvidence implements EvidenceStrategy<MutationTarget> {
  private lastNonce?: string;

  async establish(ctx: EvidenceContext): Promise<void> {
    const expiresAtMs = Date.now() + getMutationPreviewTtlMs();
    // Randomness keeps previews in the same millisecond independent, including after consumption.
    const nonce = randomBytes(16).toString('hex');
    const signature = sign(ctx, expiresAtMs, nonce);
    this.lastNonce = undefined;
    await withStore(() => getPending().set(scopeKey(ctx), signature));
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

    // Never recreate a missing entry at confirm time: absent, evicted, consumed or superseded proof
    // rejects. The read keeps a stale token from burning the latest preview; the atomic consume is
    // what decides which of two racing confirms wins.
    const key = scopeKey(ctx);
    if ((await withStore(() => getPending().get(key))) !== signature) {
      return false;
    }
    const pendingSignature: unknown = await withStore(() => getPending().consume(key));
    return pendingSignature === signature && expiresAtMs > Date.now();
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
