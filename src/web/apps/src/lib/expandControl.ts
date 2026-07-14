import type { App } from '@modelcontextprotocol/ext-apps';

import { PREVIEW_WRAPPER_CLASS } from './renderDashboardPreview.js';

// Class hooks the CSS (mcp-app.css) styles. Exported so tests assert structure without duplicating
// strings. `is-fullscreen` is toggled on `.main` (the app's root) so the preview can grow to fill
// the enlarged host surface; `expand-toggle` is the button itself.
export const EXPAND_BUTTON_CLASS = 'expand-toggle';
export const FULLSCREEN_CLASS = 'is-fullscreen';

const EXPAND_LABEL = 'Expand';
const COLLAPSE_LABEL = 'Collapse';

// A minimal inline glyph pair (static, build-time constants — never user input — so innerHTML is
// safe, same rule as the card's SVG constants). Corners-out = expand, corners-in = collapse.
const EXPAND_SVG =
  '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true">' +
  '<path d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4" stroke="currentColor" ' +
  'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const COLLAPSE_SVG =
  '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true">' +
  '<path d="M2 6h4V2M14 6h-4V2M2 10h4v4M14 10h-4v4" stroke="currentColor" ' +
  'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/**
 * Adds an "Expand" control that toggles the app between `inline` and `fullscreen` via the MCP-UI
 * display-mode API, letting the user blow the dashboard preview up to the host's large surface (in
 * Claude, the right-hand canvas) and back.
 *
 * Design constraints (see the feasibility analysis):
 * - MCP-UI display modes are `inline | fullscreen | pip` and are a TRANSITION of the single app
 *   instance — there is no separate "artifact panel" surface and no way to render in two surfaces at
 *   once. So this enlarges the existing iframe; it does not spawn a second copy.
 * - The host arbitrates: `requestDisplayMode` returns the mode the host ACTUALLY set (it may decline
 *   or clamp). We drive the UI off that returned value, never the requested one.
 * - Graceful degrade: if the host does not advertise `fullscreen` in `availableDisplayModes`, or
 *   there is no preview to enlarge, we render no button at all.
 *
 * @param app - The connected MCP App instance.
 * @returns true if an expand button was inserted; false if it was skipped (no fullscreen support or
 *   no preview to attach to).
 */
export function setupExpandControl(app: App): boolean {
  // Enlarging a bare link card is pointless — the affordance only makes sense when there is a live
  // preview to grow. Anchor the button to that wrapper.
  const preview = document.querySelector<HTMLElement>(`.${PREVIEW_WRAPPER_CLASS}`);
  if (!preview) {
    return false;
  }

  // Host must advertise `fullscreen`; if it only offers `inline` (the sole mode evidenced on some
  // hosts today) there is nothing to toggle into, so we show nothing rather than a dead button.
  const ctx = app.getHostContext();
  if (!ctx?.availableDisplayModes?.includes('fullscreen')) {
    return false;
  }

  const root = document.querySelector<HTMLElement>('.main');

  const button = document.createElement('button');
  button.type = 'button';
  button.className = EXPAND_BUTTON_CLASS;

  // Reflect whatever mode the host currently reports (default inline) so the button is correct even
  // if the app was instantiated already-fullscreen.
  const applyMode = (mode: string): void => {
    const isFullscreen = mode === 'fullscreen';
    root?.classList.toggle(FULLSCREEN_CLASS, isFullscreen);
    button.setAttribute('aria-pressed', String(isFullscreen));
    const label = isFullscreen ? COLLAPSE_LABEL : EXPAND_LABEL;
    button.setAttribute('aria-label', `${label} dashboard preview`);
    button.title = label;
    button.innerHTML = `${isFullscreen ? COLLAPSE_SVG : EXPAND_SVG}<span>${label}</span>`;
  };

  applyMode(ctx.displayMode ?? 'inline');

  button.onclick = async () => {
    const current = app.getHostContext()?.displayMode ?? 'inline';
    const target = current === 'fullscreen' ? 'inline' : 'fullscreen';
    // Never request a mode the host didn't advertise.
    if (!app.getHostContext()?.availableDisplayModes?.includes(target)) {
      return;
    }
    button.disabled = true;
    try {
      const { mode } = await app.requestDisplayMode({ mode: target });
      applyMode(mode); // drive UI off the ACTUAL mode the host set, not `target`
    } catch (e) {
      // A rejected transition leaves us in the prior mode; just log and keep the button usable.
      console.warn('[mcp-app] requestDisplayMode failed', { target, error: e });
    } finally {
      button.disabled = false;
    }
  };

  // Keep the button/label in sync when the host changes the mode on its OWN (e.g. the user exits
  // fullscreen with the host's chrome, not our button). This is the sole onhostcontextchanged
  // consumer. applyMode only touches CSS/label — it never calls requestDisplayMode — so there is no
  // feedback loop.
  app.onhostcontextchanged = () => {
    applyMode(app.getHostContext()?.displayMode ?? 'inline');
  };

  preview.appendChild(button);
  return true;
}
