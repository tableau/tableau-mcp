/**
 * Transport for the signed MCP-Apps approval token (shared by the server and the iframe bundle, so it
 * must stay dependency-free).
 *
 * The app-approval token is minted by a preview tool (delete-content, update-cloud-extract-refresh-task)
 * when the client can render the confirm panel, and must reach ONLY the iframe — never the model.
 * It therefore travels in the CallToolResult's `_meta` (which MCP-Apps hosts forward to the View with
 * the tool result but do not put in model context), never in the text `content` (which the model
 * reads). The iframe reads it back with readAppApprovalToken() and passes it to the app-only confirm
 * tool as `approvalToken`.
 */
export const APP_APPROVAL_META_KEY = 'tableau-mcp/approvalToken';

/** Returns the approval token carried in a tool result's `_meta`, or undefined. */
export function readAppApprovalToken(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') {
    return undefined;
  }
  const meta = (result as { _meta?: unknown })._meta;
  if (!meta || typeof meta !== 'object') {
    return undefined;
  }
  const token = (meta as Record<string, unknown>)[APP_APPROVAL_META_KEY];
  return typeof token === 'string' && token.length > 0 ? token : undefined;
}
