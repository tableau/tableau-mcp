import type { App } from '@modelcontextprotocol/ext-apps';

/**
 * Telemetry event types recorded by the MCP app UI. Passed directly as string
 * literals at call sites (e.g. recordEvent(app, 'FULLSCREEN_CLICKED')); the union
 * provides compile-time checking and autocomplete without a runtime constant.
 * The two *_CLICKED events distinguish which control the user activated.
 */
export type McpAppEventType =
  | 'OPEN_IN_TABLEAU_CLICKED'
  | 'FULLSCREEN_CLICKED'
  | 'TOOL_ERROR'
  | 'PARSE_ERROR'
  | 'AUTH_ERROR'
  | 'EMBED_LOAD_ERROR';

/**
 * Best-effort telemetry reporter for MCP app events (errors, user actions, etc.).
 * Calls the app-only `record-event` server tool via the host proxy. Fire-and-forget:
 * it never awaits, never throws, and silently no-ops when the host cannot
 * proxy server tools. Telemetry must never block the UI.
 *
 * `detail` and `errorMessage` are kept in separate telemetry fields so click
 * context (url, fullscreen target) never mixes with error causes: `detail`
 * populates `message` for user actions; `errorMessage` populates the dedicated
 * `errormessage` field for error events. A given event sets one or the other.
 *
 * @param app - The MCP App instance.
 * @param eventType - The event type (e.g. 'TOOL_ERROR', 'FULLSCREEN_CLICKED').
 * @param detail - Optional generic context for user actions (URL, fullscreen target, etc.).
 * @param errorMessage - Optional error/cause for error events; its message is
 *   sent as the dedicated `errormessage` field.
 */
export function recordEvent(
  app: App,
  eventType: McpAppEventType,
  detail?: unknown,
  errorMessage?: unknown,
): void {
  try {
    if (!app.getHostCapabilities()?.serverTools) {
      return;
    }

    const message = toMessage(detail);
    const errormessage = toMessage(errorMessage);
    const args: { event_type: McpAppEventType; message?: string; errormessage?: string } = {
      event_type: eventType,
    };
    if (message !== undefined) {
      args.message = message;
    }
    if (errormessage !== undefined) {
      args.errormessage = errormessage;
    }

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
