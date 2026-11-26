/**
 * Signed, cross-replica MCP-Apps approval (replaces the per-process, presence-based approval cache).
 *
 * A preview tool that can render the in-iframe confirm panel mints a SignedTokenEvidence token with
 * the separate `app-approval` purpose (its own HKDF info, `tableau-mcp/hitl-app-approval/v1`, so a
 * model-visible confirmation token can never be replayed as an approval or vice versa) and the
 * preview tool's name as a fixed namespace (the app-only confirm tool runs under a different tool
 * name, so both sides bind the namespace instead of ctx.tool). The token is bound to site, user,
 * namespace, target id, the optional parameter binding and TTL; the confirm tool verifies it with the
 * codec plus the per-process replay cache — on ANY replica sharing MUTATION_TOKEN_SECRET.
 *
 * Delivery: the token rides on the preview result object under a Symbol key (JSON.stringify drops
 * Symbol keys, so it can never leak into the model-visible text even if a caller forgets the custom
 * result builder) and is moved into CallToolResult `_meta` by appApprovalSuccessResult().
 */
import { CallToolResult } from '@modelcontextprotocol/server';

import { APP_APPROVAL_META_KEY } from '../../../utils/appApprovalMeta.js';
import { EvidenceContext } from './evidence.js';
import { SignedTokenEvidence } from './signedTokenEvidence.js';

const APP_APPROVAL_TOKEN = Symbol('appApprovalToken');

/** The evidence both the preview (establish) and the app-only confirm (verify) must construct. */
export function createAppApprovalEvidence(previewTool: string): SignedTokenEvidence {
  return new SignedTokenEvidence({ purpose: 'app-approval', namespace: previewTool });
}

/**
 * Preview side: mint the approval token for `ctx` and attach it (Symbol-keyed, never serialized) to
 * the panel result. Throws (fails closed) if no token can be minted.
 */
export async function attachAppApproval<const T extends object>(
  previewTool: string,
  ctx: EvidenceContext,
  result: T,
): Promise<T> {
  const evidence = createAppApprovalEvidence(previewTool);
  await evidence.establish(ctx);
  const token = evidence.getEstablishedNonce();
  if (!token) {
    throw new Error('Cannot issue an app-approval token');
  }
  return Object.assign(result, { [APP_APPROVAL_TOKEN]: token });
}

/**
 * logAndExecute `getSuccessResult`: the default text serialization, plus `_meta` carrying the
 * approval token when the result has one. The token is never written to `content`.
 */
export function appApprovalSuccessResult(result: unknown): CallToolResult {
  const token =
    result && typeof result === 'object'
      ? (result as { [APP_APPROVAL_TOKEN]?: string })[APP_APPROVAL_TOKEN]
      : undefined;
  return {
    isError: false,
    content: [{ type: 'text', text: JSON.stringify(result) }],
    ...(token ? { _meta: { [APP_APPROVAL_META_KEY]: token } } : {}),
  };
}
