import { ExpiringMap } from '../../../utils/expiringMap.js';
import { milliseconds } from '../../../utils/milliseconds.js';

/**
 * In-process, per-conversation CABU state: the `cabuCtx` context cookie(s) minted/refreshed by the
 * CES CABU endpoints, and the opaque `utteranceArgs` token `cabu-start-conversation` returned to the
 * caller. tableau-mcp builds a fresh REST client per tool call, so nothing else carries state across
 * the `cabu-start-conversation` → `cabu-ask` → `cabu-ask` ... call sequence that makes up one CABU
 * conversation -- see `.work/specs/W-24280234-cabu-tools.md`'s cookie-dependent-state-strategy
 * default (Phase 0 option (b)). `cookies` is NEVER returned to the caller/LLM; only `conversationId`
 * and `utteranceArgs` cross that boundary.
 */
export interface CabuConversationState {
  cookies: Array<string>;
  utteranceArgs: string;
}

// Lazy-initialized so the TTL constant below is read once, on first use, matching the
// getCache()/getApprovalCache() pattern in `../_lib/evidence.ts`.
let conversationStore: ExpiringMap<string, CabuConversationState> | null = null;

/**
 * Conversations expire 30 minutes after their last turn -- generous enough for a demo/manual
 * conversation's natural pace, short enough that an abandoned conversation's cookies don't linger
 * indefinitely in process memory. Not configurable via env var (unlike `MUTATION_PREVIEW_TTL_MINUTES`):
 * there is no caller-facing reason to tune it, and a short, fixed TTL keeps the demo/experimental
 * tool group's blast radius small.
 */
const CONVERSATION_TTL_MS = milliseconds.fromMinutes(30);

export function getCabuConversationStore(): ExpiringMap<string, CabuConversationState> {
  if (!conversationStore) {
    conversationStore = new ExpiringMap<string, CabuConversationState>({
      defaultExpirationTimeMs: CONVERSATION_TTL_MS,
    });
  }
  return conversationStore;
}
