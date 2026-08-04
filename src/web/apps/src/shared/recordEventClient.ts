import type { App } from '@modelcontextprotocol/ext-apps';

export const McpAppEvent = {
  MCP_APP_CLICKED: 'MCP_APP_CLICKED',
  TOOL_ERROR: 'TOOL_ERROR',
  PARSE_ERROR: 'PARSE_ERROR',
  AUTH_ERROR: 'AUTH_ERROR',
  EMBED_LOAD_ERROR: 'EMBED_LOAD_ERROR',
} as const;

export type McpAppEventType = (typeof McpAppEvent)[keyof typeof McpAppEvent];

/**
 * Best-effort telemetry reporter for MCP app events (errors, user actions, etc.).
 * Calls the app-only `record-event` server tool via the host proxy. Fire-and-forget:
 * it never awaits, never throws, and silently no-ops when the host cannot
 * proxy server tools. Telemetry must never block the UI.
 *
 * @param app - The MCP App instance.
 * @param eventType - The event type (e.g. 'TOOL_ERROR', 'MCP_APP_CLICKED').
 * @param detail - Optional detail context (error message, URL, etc.).
 */
export function recordEvent(app: App, eventType: McpAppEventType, detail?: unknown): void {
  try {
    if (!app.getHostCapabilities()?.serverTools) {
      return;
    }

    const message = toMessage(detail);
    const args =
      message !== undefined ? { event_type: eventType, message } : { event_type: eventType };

    void app.callServerTool({ name: 'record-event', arguments: args }).catch(() => {
      // Best-effort telemetry: swallow transport failures.
    });
  } catch {
    // Never let telemetry reporting break the UI.
  }
}

function toMessage(detail: unknown): string | undefined {
  if (detail === undefined || detail === null) {
    return undefined;
  }
  return detail instanceof Error ? detail.message : String(detail);
}
