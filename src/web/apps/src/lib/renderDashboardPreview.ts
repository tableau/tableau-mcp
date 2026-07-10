import { TABLEAU_VIZ_CONTAINER_ID } from './embedTableauViz.js';

// Class names the CSS (mcp-app.css) styles. Kept as constants so the tests can assert structure
// without hard-coding strings in two places.
export const PREVIEW_WRAPPER_CLASS = 'dashboard-preview';
export const PREVIEW_FRAME_CLASS = 'dashboard-preview-frame';

/**
 * Renders a live preview of the model-built dashboard HTML into the app container, ABOVE the
 * published-workbook card.
 *
 * Security: the HTML is model-generated and therefore untrusted, so it must never touch the app's
 * own document/origin — that origin holds the app<->host postMessage bridge, `openLink`, and (once
 * mcp-apps is enabled) the embed-token path. We render it in a NESTED child iframe with
 * `sandbox="allow-scripts"` and NO `allow-same-origin`: the child runs in an opaque origin, so its
 * scripts can execute but cannot reach our window, our storage, or the parent bridge. We inject via
 * `srcdoc` (not a network URL), so nothing is fetched and no extra origin is contacted.
 *
 * CSP note: a nested frame renders only because the app resource declares `frameDomains` (see
 * server.web.ts) — an omitted `frameDomains` compiles to `frame-src 'none'` and would blank the
 * preview. A `srcdoc` document is same-origin-as-embedder for CSP purposes, so the parent frame's
 * `frame-src` (which already lists the Tableau domains) admits it.
 *
 * Data caveat (surfaced to the user, not hidden): because the sandbox is an opaque origin, a
 * dashboard that queries live data via *same-origin* VDS at runtime will render its chrome without
 * data here — the published workbook still gets live data from its real Tableau origin. A dashboard
 * that inlines its already-queried results renders fully. Either way the user sees what was built.
 *
 * @param html - The built dashboard HTML (the tool's `html` input argument).
 * @returns true if a preview element was inserted; false if the container was missing.
 */
export function renderDashboardPreview(html: string): boolean {
  const container = document.getElementById(TABLEAU_VIZ_CONTAINER_ID);
  if (!container) {
    return false;
  }

  const wrapper = document.createElement('div');
  wrapper.className = PREVIEW_WRAPPER_CLASS;

  const frame = document.createElement('iframe');
  frame.className = PREVIEW_FRAME_CLASS;
  frame.setAttribute('title', 'Dashboard preview');
  // allow-scripts ONLY: opaque origin, scripts run, no access to our origin/bridge/token. Explicitly
  // NOT allow-same-origin (that would defeat the isolation) and NOT allow-top-navigation/-popups.
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  // srcdoc carries the untrusted HTML inline — no network fetch, no extra origin contacted.
  frame.setAttribute('srcdoc', html);

  wrapper.appendChild(frame);
  // The card renderer uses container.replaceChildren(card), so it would wipe anything already in the
  // container. Callers therefore render the card FIRST, then call this — we prepend so the layout is
  // preview-on-top, card-below, without clobbering the card. See handleToolResult.
  container.prepend(wrapper);
  return true;
}
