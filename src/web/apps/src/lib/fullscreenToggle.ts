/**
 * @file Fullscreen display mode toggle for MCP apps
 */

import type { App } from '@modelcontextprotocol/ext-apps';

const FULLSCREEN_TOGGLE_CLASS = 'fullscreen-toggle';

/**
 * Applies or removes fullscreen state classes to the container and its parent main element.
 *
 * @param container - The container element
 * @param isFullscreen - Whether fullscreen mode is active
 */
function applyFullscreenState(container: HTMLElement, isFullscreen: boolean): void {
  container.classList.toggle('fullscreen', isFullscreen);

  // Also apply to parent main element if present
  const main = container.closest('main');
  if (main) {
    main.classList.toggle('fullscreen', isFullscreen);
  }
}

/**
 * Sets up a fullscreen toggle control for the MCP app.
 * Only renders the control if the host supports fullscreen display mode.
 *
 * @param app - The MCP App instance
 * @param container - The container element to apply fullscreen class to
 */
export function setupFullscreenToggle(app: App, container: HTMLElement): void {
  const hostContext = app.getHostContext();

  // Graceful degradation: no control if fullscreen not available
  if (
    !hostContext?.availableDisplayModes ||
    !hostContext.availableDisplayModes.includes('fullscreen')
  ) {
    return;
  }

  // Idempotency: remove any existing control
  const existingControl = container.querySelector(`.${FULLSCREEN_TOGGLE_CLASS}`);
  if (existingControl) {
    existingControl.remove();
  }

  // Create toggle button
  const button = document.createElement('button');
  button.className = FULLSCREEN_TOGGLE_CLASS;
  button.setAttribute('role', 'button');
  button.setAttribute('aria-label', 'Toggle fullscreen mode');
  button.setAttribute('tabindex', '0');
  button.textContent = '⤢'; // Expand icon

  // Set initial aria-pressed based on current mode
  const isFullscreen = hostContext.displayMode === 'fullscreen';
  button.setAttribute('aria-pressed', String(isFullscreen));

  // Apply initial class state
  applyFullscreenState(container, isFullscreen);

  // Handle click to toggle display mode
  button.addEventListener('click', async () => {
    const currentContext = app.getHostContext();
    const currentMode = currentContext?.displayMode ?? 'inline';
    const targetMode = currentMode === 'fullscreen' ? 'inline' : 'fullscreen';

    try {
      const result = await app.requestDisplayMode({ mode: targetMode });

      // Apply the ACTUAL granted mode (may differ from requested)
      const grantedMode = result.mode;
      const isNowFullscreen = grantedMode === 'fullscreen';

      applyFullscreenState(container, isNowFullscreen);
      button.setAttribute('aria-pressed', String(isNowFullscreen));
    } catch (error) {
      console.warn('Failed to change display mode:', error);
    }
  });

  // Append to container
  container.appendChild(button);
}
