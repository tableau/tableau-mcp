import type { App } from '@modelcontextprotocol/ext-apps';

import DISCONNECTED_SVG from './assets/disconnected.svg?raw';
import { recordEvent } from './recordEventClient.js';
import { TABLEAU_VIZ_CONTAINER_ID } from './vizContainer.js';

export type Scenario = 'TOOL_ERROR' | 'PARSE_ERROR' | 'AUTH_ERROR' | 'EMBED_LOAD_ERROR';

const ERROR_HEADING = 'Unable to load this Tableau view';

const ERROR_UI: Record<Scenario, { detail: string; logCode: string }> = {
  TOOL_ERROR: {
    detail: 'The tool request was unsuccessful.',
    logCode: '[mcp-app:tool-error] Tool returned an error result',
  },
  PARSE_ERROR: {
    detail: 'The response was not in the expected format.',
    logCode: '[mcp-app:parse-error] Failed to parse tool result',
  },
  AUTH_ERROR: {
    detail: 'Authentication was unsuccessful.',
    logCode: '[mcp-app:auth-error] Failed to obtain or use embed token',
  },
  EMBED_LOAD_ERROR: {
    detail: 'The visualization failed to load.',
    logCode: '[mcp-app:embed-load-error] Tableau Embedding API failed to load',
  },
};

/**
 * Shows an error message in the tableau viz container
 * @param scenario - The error scenario to display
 * @param cause - Optional error that caused this scenario
 * @param app - Optional MCP App instance for telemetry reporting
 */
export function showError(scenario: Scenario, cause?: unknown, app?: App): void {
  // Report telemetry first (best-effort), so errors are recorded even when the
  // container is missing and the error UI cannot be rendered.
  if (app) {
    recordEvent(app, scenario, cause);
  }

  const container = document.getElementById(TABLEAU_VIZ_CONTAINER_ID);
  if (!container) {
    return;
  }

  const errorElement = document.createElement('div');
  errorElement.className = 'mcp-app-error';
  errorElement.setAttribute('role', 'alert');

  // Add disconnected illustration icon
  const iconWrapper = document.createElement('div');
  iconWrapper.className = 'mcp-app-error-icon';
  iconWrapper.setAttribute('aria-hidden', 'true');
  // Safe to use innerHTML here: DISCONNECTED_SVG is a static, trusted, build-time constant (never user input)
  iconWrapper.innerHTML = DISCONNECTED_SVG;

  // Add error text block (heading + message)
  const textWrapper = document.createElement('div');
  textWrapper.className = 'mcp-app-error-text';

  const headingElement = document.createElement('h2');
  headingElement.className = 'mcp-app-error-heading';
  headingElement.textContent = ERROR_HEADING;

  const messageElement = document.createElement('p');
  messageElement.className = 'mcp-app-error-message';
  messageElement.textContent = ERROR_UI[scenario].detail;

  textWrapper.append(headingElement, messageElement);
  errorElement.append(iconWrapper, textWrapper);
  container.replaceChildren(errorElement);
}
