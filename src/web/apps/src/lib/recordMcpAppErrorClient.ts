import type { App } from '@modelcontextprotocol/ext-apps';

/**
 * Best-effort telemetry reporter for MCP app errors. Calls the app-only
 * `record-mcp-app-error` server tool via the host proxy. Fire-and-forget:
 * it never awaits, never throws, and silently no-ops when the host cannot
 * proxy server tools. Telemetry must never break the error UI.
 *
 * @param app - The MCP App instance.
 * @param scenario - The error category (e.g. the showError Scenario).
 * @param cause - Optional underlying error; its message is forwarded when present.
 */
export function reportMcpAppError(app: App, scenario: string, cause?: unknown): void {
  try {
    if (!app.getHostCapabilities()?.serverTools) {
      return;
    }

    const message = toErrorMessage(cause);
    const args = message !== undefined ? { scenario, message } : { scenario };

    void app.callServerTool({ name: 'record-mcp-app-error', arguments: args }).catch(() => {
      // Best-effort telemetry: swallow transport failures.
    });
  } catch {
    // Never let telemetry reporting break the error UI.
  }
}

function toErrorMessage(cause: unknown): string | undefined {
  if (cause === undefined || cause === null) {
    return undefined;
  }
  return cause instanceof Error ? cause.message : String(cause);
}
