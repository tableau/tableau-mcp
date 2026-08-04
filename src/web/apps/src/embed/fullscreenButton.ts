import type { App } from '@modelcontextprotocol/ext-apps';

import { McpAppEvent, recordEvent } from '../shared/recordEventClient.js';

const FULLSCREEN_BUTTON_ID = 'fullscreenButton';

// Listeners registered on `app` and `document` outlive the button element, so a
// re-render (setupFullscreenButton called again) must tear the previous ones down
// to avoid leaks and duplicate handlers. This app UI is a singleton, so a single
// module-level teardown reference is sufficient.
let teardownPrevious: (() => void) | undefined;

/** Syncs the button's visibility and ARIA state to the given mode. */
function syncButton(button: HTMLButtonElement, fullscreen: boolean): void {
  // Hide the button when in fullscreen (host chrome provides exit affordance)
  button.hidden = fullscreen;

  button.setAttribute('aria-pressed', String(fullscreen));
  // When inline (visible), label is "Fullscreen" / "Enter fullscreen"
  // When fullscreen (hidden), ARIA is moot but keep it consistent
  button.setAttribute('aria-label', fullscreen ? 'Exit fullscreen' : 'Enter fullscreen');

  // Update the label span text WITHOUT destroying the icon
  const labelSpan = button.querySelector('span');
  if (labelSpan) {
    labelSpan.textContent = fullscreen ? 'Exit fullscreen' : 'Fullscreen';
  }
}

/**
 * Sets up the Fullscreen toggle button. Expands the app to fill the host panel via
 * the ext-apps display-mode API (host-mediated; NOT the browser Fullscreen API).
 * Renders only when the host advertises the 'fullscreen' display mode.
 *
 * @param app - MCP App instance.
 * @param container - Element to append the button to (the `.main` element).
 */
export function setupFullscreenButton(app: App, container: HTMLElement): void {
  // Tear down listeners from any previous invocation, then drop the stale button.
  teardownPrevious?.();
  teardownPrevious = undefined;
  container.querySelector(`#${FULLSCREEN_BUTTON_ID}`)?.remove();

  // Capability gate: the host must advertise the fullscreen display mode.
  // (Display modes live in host CONTEXT, not in getHostCapabilities().)
  const availableModes = app.getHostContext()?.availableDisplayModes;
  if (!availableModes?.includes('fullscreen')) {
    return;
  }

  // Track the current display mode internally. This is the single source of truth
  // for the toggle decision. Initialized from the host context, then updated from:
  // - requestMode's result (authoritative for our own requests), OR
  // - hostcontextchanged (authoritative for host-initiated changes).
  // DO NOT read getHostContext().displayMode in the click handler — it is only
  // updated on hostcontextchanged, not when requestDisplayMode resolves.
  let isFullscreen = app.getHostContext()?.displayMode === 'fullscreen';

  const button = document.createElement('button');
  button.type = 'button';
  button.id = FULLSCREEN_BUTTON_ID;
  button.className = 'viz-fullscreen-floating';

  // Create icon (inline SVG using the symbol)
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('class', 'viz-control-icon');
  icon.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '#fullscreen-icon');
  icon.appendChild(use);

  // Create label span
  const label = document.createElement('span');

  // Assemble button: icon + label (left to right)
  button.appendChild(icon);
  button.appendChild(label);

  syncButton(button, isFullscreen);

  const onKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      void requestMode('inline');
    }
  };

  // Escape-to-exit is only active while in fullscreen. The DOM dedupes identical
  // listeners, so repeated true/false calls are safe.
  function setEscapeListener(fullscreen: boolean): void {
    if (fullscreen) {
      document.addEventListener('keydown', onKeydown);
    } else {
      document.removeEventListener('keydown', onKeydown);
    }
  }

  // The host is the source of truth: reflect the mode it actually applied
  // (it may refuse the request and keep the current mode).
  async function requestMode(mode: 'inline' | 'fullscreen'): Promise<void> {
    try {
      const result = await app.requestDisplayMode({ mode });
      isFullscreen = result.mode === 'fullscreen';
      syncButton(button, isFullscreen);
      setEscapeListener(isFullscreen);
    } catch (error) {
      console.warn('[mcp-app] requestDisplayMode failed', { mode, error });
    }
  }

  button.addEventListener('click', () => {
    const target = isFullscreen ? 'inline' : 'fullscreen';
    recordEvent(app, McpAppEvent.MCP_APP_CLICKED, target);
    void requestMode(target);
  });

  // Re-sync if the host changes display mode on its own (e.g. host chrome exit).
  const onHostContextChanged = (): void => {
    isFullscreen = app.getHostContext()?.displayMode === 'fullscreen';
    syncButton(button, isFullscreen);
    setEscapeListener(isFullscreen);
  };
  app.addEventListener('hostcontextchanged', onHostContextChanged);

  // Initialize the Escape listener to match the current mode.
  setEscapeListener(isFullscreen);

  teardownPrevious = () => {
    // SAFETY: App re-declares addEventListener but not removeEventListener, so TS
    // loses the inherited ProtocolWithEvents.removeEventListener signature. The method
    // exists at runtime (inherited from the base class). Cast through unknown to access it.
    (app as unknown as { removeEventListener: typeof app.addEventListener }).removeEventListener(
      'hostcontextchanged',
      onHostContextChanged,
    );
    document.removeEventListener('keydown', onKeydown);
  };

  // Append to the viz-stage wrapper (floating over viz bottom-right)
  const vizStage = container.querySelector('#vizStage');
  if (vizStage) {
    vizStage.appendChild(button);
  } else {
    // Fallback: append to container if wrapper is missing
    container.appendChild(button);
  }
}
