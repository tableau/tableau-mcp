import type { App } from '@modelcontextprotocol/ext-apps';

import { recordEvent } from '../shared/recordEventClient.js';
import { createControlIcon } from './controlIcon.js';
import { getOrCreateOverlayGroup } from './overlayGroup.js';

const FULLSCREEN_BUTTON_ID = 'fullscreenButton';

// Listeners registered on `app` and `document` outlive the button element, so a
// re-render (setupFullscreenButton called again) must tear the previous ones down
// to avoid leaks and duplicate handlers. This app UI is a singleton, so a single
// module-level teardown reference is sufficient.
let teardownPrevious: (() => void) | undefined;

/**
 * Syncs visibility, ARIA state, and the mode class to the given mode.
 *
 * @param modeRoot - The app root (`.main`). Carries the `.fullscreen` class so CSS
 *   can key layout off the mode — notably the inline height cap
 *   (`.main:not(.fullscreen) tableau-viz`), which is dropped in fullscreen so the
 *   viz uses its natural height.
 * @param visibilityTarget - Element hidden in fullscreen. This is the whole overlay
 *   pill (so BOTH controls disappear when the host provides its own exit affordance),
 *   or the button itself when there is no pill (fallback path).
 * @param button - The fullscreen button, whose ARIA state and label always track the mode.
 * @param fullscreen - Whether the app is currently in fullscreen mode.
 */
function syncButton(
  modeRoot: HTMLElement,
  visibilityTarget: HTMLElement,
  button: HTMLButtonElement,
  fullscreen: boolean,
): void {
  // Drive the mode class off the same source of truth as the pill. The inline
  // height cap keys off `.main:not(.fullscreen)`, so entering fullscreen removes
  // the cap and exiting reinstates it — no separate code path to drift.
  modeRoot.classList.toggle('fullscreen', fullscreen);

  // Hide the pill when in fullscreen (host chrome provides exit affordance).
  visibilityTarget.hidden = fullscreen;

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
 * Builds the fullscreen toggle button element: an `.overlay-control` button holding
 * the fullscreen icon (leading) and an empty label span. The label text, ARIA state,
 * and mode class are all set later by {@link syncButton} to match the current mode,
 * so this builder only assembles the static structure — no state, no listeners.
 *
 * @returns The assembled button, not yet attached to the DOM.
 */
function createFullscreenButtonElement(): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.id = FULLSCREEN_BUTTON_ID;
  button.className = 'overlay-control';

  // Create icon (inline SVG using the symbol)
  const icon = createControlIcon('#fullscreen-icon');

  // Create label span
  const label = document.createElement('span');

  // Assemble button: icon + label (icon leads, matching Option B's Fullscreen control)
  button.appendChild(icon);
  button.appendChild(label);

  return button;
}

/**
 * Sets up the Fullscreen toggle button. Expands the app to fill the host panel via
 * the ext-apps display-mode API (host-mediated; NOT the browser Fullscreen API).
 * Renders only when the host advertises the 'fullscreen' display mode.
 *
 * The button is the right-hand control in the shared floating overlay pill
 * (`.overlay-group`) that lives in `#vizStage`, alongside the "Open in Tableau" link.
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

  const button = createFullscreenButtonElement();

  // Append to the shared overlay pill as the right-hand (last) control. Falls back
  // to the container when the pill's host (#vizStage) is missing.
  const overlayGroup = getOrCreateOverlayGroup(container);
  (overlayGroup ?? container).appendChild(button);

  // In fullscreen, hide the entire pill (both controls); without a pill, hide the button.
  const visibilityTarget: HTMLElement = overlayGroup ?? button;

  // Current display mode, the single source of truth for the toggle decision. Only ever
  // written through reflectMode (below); established for real by the reflectMode() init call
  // at the end of setup, so it starts false here rather than reading the host directly.
  let isFullscreen = false;

  // Reads the mode the host currently reports. Used to seed initial state and to react to
  // host-initiated changes — NOT in the click handler: getHostContext().displayMode only
  // updates on hostcontextchanged, not when our own requestDisplayMode resolves, so the
  // click handler must read `isFullscreen` instead.
  const hostIsFullscreen = (): boolean => app.getHostContext()?.displayMode === 'fullscreen';

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

  // The ONLY writer of isFullscreen. Every mode change routes through here so all
  // mode-dependent state — the button chrome and the Escape listener — is re-derived
  // together and cannot drift out of sync with the flag.
  function reflectMode(fullscreen: boolean): void {
    isFullscreen = fullscreen;
    syncButton(container, visibilityTarget, button, fullscreen);
    setEscapeListener(fullscreen);
  }

  // The host is the source of truth: reflect the mode it actually applied
  // (it may refuse the request and keep the current mode).
  async function requestMode(mode: 'inline' | 'fullscreen'): Promise<void> {
    try {
      const result = await app.requestDisplayMode({ mode });
      reflectMode(result.mode === 'fullscreen');
    } catch (error) {
      console.warn('[mcp-app] requestDisplayMode failed', { mode, error });
    }
  }

  button.addEventListener('click', () => {
    const target = isFullscreen ? 'inline' : 'fullscreen';
    recordEvent(app, 'FULLSCREEN_CLICKED', target);
    void requestMode(target);
  });

  // Re-sync if the host changes display mode on its own (e.g. host chrome exit).
  const onHostContextChanged = (): void => reflectMode(hostIsFullscreen());
  app.addEventListener('hostcontextchanged', onHostContextChanged);

  // Paint initial state from the host's current mode (also attaches the Escape
  // listener when we start in fullscreen).
  reflectMode(hostIsFullscreen());

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
}
