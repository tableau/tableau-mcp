/**
 * SignedTokenEvidence — HMAC-signed, short-lived HITL token. Used with two purposes (separate
 * HKDF-derived keys, see SignedTokenPurpose):
 * - 'confirmation': the model-visible confirmationToken of update-user,
 *   update-cloud-extract-refresh-task, the extract-refresh-task branch of delete-content, run-flow,
 *   run-flow-task and cancel-flow-run (via signedConfirmation.ts).
 * - 'app-approval': the MCP-Apps approval token the delete-content and
 *   update-cloud-extract-refresh-task previews hand to the confirm panel in `_meta`, verified by
 *   confirm-delete-content and confirm-update-cloud-extract-refresh-task (via appApproval.ts).
 *
 * It replaced an in-memory nonce registry, which rejected a confirm that landed on a different
 * replica (or after a restart). SignedTokenEvidence instead mints a
 * self-verifying token (see confirmationTokenCodec.ts) bound to site + user + tool + target +
 * parameter binding + the target's pre-state. Any replica holding the same `MUTATION_TOKEN_SECRET`
 * can verify it; nothing is stored at preview time.
 *
 * Guarantees kept from the in-memory nonce registry:
 * - Un-forgeable: a token can only come from a server holding the key.
 * - Bound: a token for one site/user/tool/target/parameter set cannot confirm another.
 * - Can only reject: every failure path returns false (or throws), never a wrongful allow.
 *
 * Changed guarantee (documented, by design): "single-use" becomes "short-lived and bound to this
 * change". A per-process replay cache (keyed by tokenId, entries live for the token's remaining
 * lifetime) rejects a replay on the SAME replica. A replay on ANOTHER replica within the TTL is
 * accepted only if the target's pre-state is unchanged — for update-user and
 * update-cloud-extract-refresh-task that means the first confirm already applied the change, so the
 * replay re-applies the identical change (idempotent). For the stateless targets (extract-task
 * delete, cancel-flow-run) the second call hits an already-deleted / already-cancelled target. For
 * run-flow / run-flow-task the pre-state is the flow's newest runs (flowRunPreState.ts), which the
 * first confirm's new run normally changes.
 *
 * Key material:
 * - `MUTATION_TOKEN_SECRET` (>= 32 chars) → HKDF-derived signing key, shared across replicas.
 * - `MUTATION_TOKEN_SECRET_PREVIOUS` (optional, >= 32 chars) → verify-only key during rotation.
 * - Neither set → one random key per process (process-wide singleton): tokens verify only on the
 *   replica that minted them (the same behaviour as the old in-memory registry).
 * A secret shorter than 32 characters throws (at startup via initializeConfirmationTokenKeys).
 *
 * NEVER log the secret, the derived keys, or a token. describeEvidence() returns a fixed string.
 */
import { Config, getConfig } from '../../../config.js';
import { ConfirmationIdentityMissingError } from '../../../errors/mcpToolError.js';
import { log } from '../../../logging/logger.js';
import { ExpiringMap } from '../../../utils/expiringMap.js';
import {
  APP_APPROVAL_TOKEN_HKDF_INFO,
  BoundTokenFields,
  CONFIRMATION_TOKEN_HKDF_INFO,
  ConfirmationTokenCodec,
  ConfirmationTokenKeys,
  deriveConfirmationTokenKey,
  generateConfirmationTokenKey,
  isWellFormedConfirmationToken,
  TokenFields,
  VerifyFailureReason,
} from './confirmationTokenCodec.js';
import { EvidenceContext, EvidenceStrategy, getMutationPreviewTtlMs } from './evidence.js';
import { MutationTarget } from './mutationGuard.js';

export const MUTATION_TOKEN_SECRET_MIN_LENGTH = 32;
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

const STATE_CHANGED_EXPLANATION =
  'The target changed after the preview, so this confirmation no longer matches it. ' +
  'Run the preview again to see the current state.';

/** Raw secret strings, as read from config. */
interface SecretSource {
  secret: string;
  previousSecret: string;
}

function validateSecret(value: string, envVarName: string): void {
  if (value.length > 0 && value.length < MUTATION_TOKEN_SECRET_MIN_LENGTH) {
    // Name the variable and the rule only, never the value.
    throw new Error(
      `${envVarName} must be at least ${MUTATION_TOKEN_SECRET_MIN_LENGTH} characters long`,
    );
  }
}

/**
 * What a token authorizes. Each purpose gets its own HKDF-derived key, so a token minted for one
 * purpose never verifies for the other:
 * - 'confirmation': the model-visible `confirmationToken` of a preview→confirm tool.
 * - 'app-approval': the MCP-Apps approval token, delivered to the iframe in `_meta` (never in
 *   model-visible text) and passed back to an app-only confirm tool.
 */
export type SignedTokenPurpose = 'confirmation' | 'app-approval';

const PURPOSE_HKDF_INFO: Record<SignedTokenPurpose, string> = {
  confirmation: CONFIRMATION_TOKEN_HKDF_INFO,
  'app-approval': APP_APPROVAL_TOKEN_HKDF_INFO,
};

/**
 * Builds the key pair from the configured secrets for one purpose. The secrets arrive already
 * trimmed by Config (the single place they are read and normalized; a whitespace-only value is ''),
 * so they are used as-is. Throws on a too-short secret, and when only a previous secret is set
 * (rotation with no current secret is a misconfiguration).
 */
export function resolveConfirmationTokenKeys(
  { secret, previousSecret }: SecretSource,
  purpose: SignedTokenPurpose = 'confirmation',
): ConfirmationTokenKeys {
  validateSecret(secret, 'MUTATION_TOKEN_SECRET');
  validateSecret(previousSecret, 'MUTATION_TOKEN_SECRET_PREVIOUS');
  if (!secret) {
    if (previousSecret) {
      throw new Error('MUTATION_TOKEN_SECRET_PREVIOUS is set but MUTATION_TOKEN_SECRET is not');
    }
    return { current: getProcessRandomKey(purpose) };
  }
  const info = PURPOSE_HKDF_INFO[purpose];
  return {
    current: deriveConfirmationTokenKey(secret, info),
    previous: previousSecret ? deriveConfirmationTokenKey(previousSecret, info) : undefined,
  };
}

// Process-wide singletons, one per purpose. The random keys exist only when no secret is configured,
// and are created once so every SignedTokenEvidence instance in this process agrees on them.
const processRandomKeys = new Map<SignedTokenPurpose, Buffer>();
const processKeys = new Map<SignedTokenPurpose, ConfirmationTokenKeys>();
let processReplayCache: ExpiringMap<string, true> | undefined;

function getProcessRandomKey(purpose: SignedTokenPurpose): Buffer {
  let key = processRandomKeys.get(purpose);
  if (!key) {
    key = generateConfirmationTokenKey();
    processRandomKeys.set(purpose, key);
  }
  return key;
}

/**
 * The configured secrets. Single source: the server config (getConfig(), which reads
 * MUTATION_TOKEN_SECRET / MUTATION_TOKEN_SECRET_PREVIOUS once). Trimming and validation happen in
 * resolveConfirmationTokenKeys, not here.
 */
function readSecretSource(config: Config = getConfig()): SecretSource {
  return {
    secret: config.mutationTokenSecret,
    previousSecret: config.mutationTokenSecretPrevious,
  };
}

function getProcessKeys(purpose: SignedTokenPurpose): ConfirmationTokenKeys {
  let keys = processKeys.get(purpose);
  if (!keys) {
    keys = resolveConfirmationTokenKeys(readSecretSource(), purpose);
    processKeys.set(purpose, keys);
  }
  return keys;
}

function getProcessReplayCache(): ExpiringMap<string, true> {
  // The default expiry is never used (every set() passes the token's remaining lifetime).
  processReplayCache ??= new ExpiringMap<string, true>({ defaultExpirationTimeMs: 60_000 });
  return processReplayCache;
}

/**
 * Startup hook (called from initializeWebRuntime): fails fast on a bad secret and logs one warning
 * when session management is disabled (stateless, typically load-balanced) and no secret is set —
 * in that setup a confirm routed to another replica would be rejected.
 */
export function initializeConfirmationTokenKeys(config: Config): void {
  const source = readSecretSource(config);
  for (const purpose of Object.keys(PURPOSE_HKDF_INFO) as SignedTokenPurpose[]) {
    processKeys.set(purpose, resolveConfirmationTokenKeys(source, purpose));
  }
  // Resolve the TTL once at startup so an out-of-range MUTATION_PREVIEW_TTL_MINUTES is clamped and
  // warned about now, not on the first preview.
  getMutationPreviewTtlMs();
  if (config.disableSessionManagement && !source.secret) {
    log({
      message:
        'DISABLE_SESSION_MANAGEMENT=true but MUTATION_TOKEN_SECRET is not set: HITL confirmation ' +
        'tokens are signed with a per-process random key and will only verify on the replica that ' +
        'issued them. Set the same MUTATION_TOKEN_SECRET on every replica.',
      level: 'warning',
      logger: 'startup',
    });
  }
}

export interface SignedTokenEvidenceOptions {
  /** Inject keys (tests: two instances with one secret model two replicas). Default: process keys. */
  keys?: ConfirmationTokenKeys;
  /** Injectable clock. Default Date.now. */
  now?: () => number;
  /** Token lifetime. Default MUTATION_PREVIEW_TTL_MINUTES (getMutationPreviewTtlMs). */
  ttlMs?: number;
  /** Inject a private replay cache (tests: a separate "replica"). Default: process-wide cache. */
  replayCache?: ExpiringMap<string, true>;
  /** Which key signs the token. Default 'confirmation'. Ignored when `keys` is injected. */
  purpose?: SignedTokenPurpose;
  /**
   * Fixed value bound in place of `ctx.tool`. Needed when the preview and the confirm run under
   * different tool names (an MCP-Apps preview tool and its app-only confirm tool): both sides pass
   * the preview tool's name so the token resolves across the pair. Default: `ctx.tool`.
   */
  namespace?: string;
}

export class SignedTokenEvidence implements EvidenceStrategy<MutationTarget> {
  private readonly options: SignedTokenEvidenceOptions;
  private codec?: ConfirmationTokenCodec;
  // The token minted by the most recent establish(), for the preview response text. NEVER audited.
  private lastToken?: string;
  private lastRejection?: VerifyFailureReason | 'replayed' | 'missing-identity';
  // The tokenId the most recent successful verify() added to the replay cache, for release().
  private lastVerifiedTokenId?: string;

  constructor(options: SignedTokenEvidenceOptions = {}) {
    this.options = options;
  }

  private getCodec(): ConfirmationTokenCodec {
    this.codec ??= new ConfirmationTokenCodec(
      this.options.keys ?? getProcessKeys(this.options.purpose ?? 'confirmation'),
      this.now,
    );
    return this.codec;
  }

  private readonly now = (): number => (this.options.now ?? Date.now)();

  private getReplayCache(): ExpiringMap<string, true> {
    return this.options.replayCache ?? getProcessReplayCache();
  }

  private boundFields(
    ctx: Omit<EvidenceContext, 'target'> & { target: { id: string } },
  ): BoundTokenFields {
    return {
      siteId: ctx.siteId,
      userLuid: ctx.userLuid,
      tool: this.options.namespace ?? ctx.tool,
      targetId: ctx.target.id,
      binding: ctx.binding ?? '',
    };
  }

  private fields(ctx: EvidenceContext): TokenFields {
    return { ...this.boundFields(ctx), state: ctx.target.state ?? '' };
  }

  async establish(ctx: EvidenceContext): Promise<void> {
    this.lastToken = undefined;
    // Fail closed: a token bound to an empty site or user would not identify who it was issued to.
    // Typed so guardMutation audits it as a 'denied' preview and the caller gets a clean isError.
    if (!ctx.siteId || !ctx.userLuid) {
      throw new ConfirmationIdentityMissingError();
    }
    this.lastToken = this.getCodec().mint(
      this.fields(ctx),
      this.options.ttlMs ?? getMutationPreviewTtlMs(),
    );
  }

  /**
   * EvidenceStrategy.precheck: rejects a missing or malformed token (shape only: no key, no clock,
   * no I/O). Used by guardMutation to skip resolveTarget() for a confirm that cannot pass.
   */
  precheck(confirmationToken: string | undefined): boolean {
    if (isWellFormedConfirmationToken(confirmationToken)) {
      return true;
    }
    this.lastRejection = 'malformed';
    return false;
  }

  /**
   * Checks everything that does NOT depend on the target's live pre-state: identity, shape, expiry,
   * MAC (computed over the token's OWN preState field) and the same-replica replay cache. Consumes
   * nothing. A caller that must do REST reads to produce the live pre-state (SignedConfirmation's
   * resolveState) calls this first, so a forged, tampered, expired or replayed token is rejected
   * without any REST call, and `state-changed` is only ever reported for an authentic, unexpired
   * token. verify() still re-runs every check (atomically with the replay-cache add) afterwards.
   * `ctx.target.state` is ignored.
   */
  preVerify(ctx: Omit<EvidenceContext, 'target'> & { target: { id: string } }): boolean {
    this.lastRejection = undefined;
    if (!ctx.siteId || !ctx.userLuid) {
      this.lastRejection = 'missing-identity';
      return false;
    }
    if (!ctx.confirmationToken) {
      this.lastRejection = 'malformed';
      return false;
    }
    const result = this.getCodec().authenticate(ctx.confirmationToken, this.boundFields(ctx));
    if (!result.ok) {
      this.lastRejection = result.reason;
      return false;
    }
    if (this.getReplayCache().has(result.token.tokenId)) {
      this.lastRejection = 'replayed';
      return false;
    }
    return true;
  }

  async verify(ctx: EvidenceContext): Promise<boolean> {
    this.lastRejection = undefined;
    this.lastVerifiedTokenId = undefined;
    if (!ctx.siteId || !ctx.userLuid) {
      this.lastRejection = 'missing-identity';
      return false;
    }
    if (!ctx.confirmationToken) {
      this.lastRejection = 'malformed';
      return false;
    }
    const result = this.getCodec().verify(ctx.confirmationToken, this.fields(ctx));
    if (!result.ok) {
      this.lastRejection = result.reason;
      return false;
    }
    // Same-replica replay guard. Check-and-add are synchronous with no await between them, so two
    // concurrent confirms of one token on this process cannot both pass.
    const cache = this.getReplayCache();
    if (cache.has(result.tokenId)) {
      this.lastRejection = 'replayed';
      return false;
    }
    const remainingMs = Math.min(MAX_TIMEOUT_MS, Math.max(1, result.expiresAtMs - this.now()));
    cache.set(result.tokenId, true, remainingMs);
    this.lastVerifiedTokenId = result.tokenId;
    return true;
  }

  /**
   * Undo the last successful verify's replay-cache entry. Called by the guard when a target-state
   * precondition rejects AFTER verify, so a rejected (non-mutating) confirm does not burn the token:
   * the caller can retry with the same token once the precondition holds. Check-and-add in verify()
   * stays synchronous, so concurrent confirms of one token are still serialized; release() only
   * reopens the token after the reserving confirm has decided not to mutate.
   */
  release(): void {
    if (this.lastVerifiedTokenId !== undefined) {
      this.getReplayCache().delete(this.lastVerifiedTokenId);
      this.lastVerifiedTokenId = undefined;
    }
  }

  /** Only a state change gets an explanation; other failures stay generic ("preview again"). */
  explainRejection(): string | undefined {
    return this.lastRejection === 'state-changed' ? STATE_CHANGED_EXPLANATION : undefined;
  }

  describeEvidence(): { kind: 'signed-token'; detail?: string } {
    // Distinct audit kind so signed tokens (replayable across replicas within the TTL) are never
    // confused with the former strictly single-use registry nonce. Fixed string: never the token.
    return {
      kind: 'signed-token',
      detail:
        this.options.purpose === 'app-approval'
          ? 'signed short-lived app-approval token (human gesture in MCP-Apps iframe)'
          : 'signed short-lived confirmation token bound to site, user, tool, target and change',
    };
  }

  /** The token minted by the last establish(), for the preview response text. Never audited. */
  getEstablishedNonce(): string | undefined {
    return this.lastToken;
  }
}

export const exportedForTesting = {
  reset(): void {
    processRandomKeys.clear();
    processKeys.clear();
    processReplayCache?.clear();
    processReplayCache = undefined;
  },
  STATE_CHANGED_EXPLANATION,
};
