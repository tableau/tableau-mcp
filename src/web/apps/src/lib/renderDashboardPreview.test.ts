/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TABLEAU_VIZ_CONTAINER_ID } from './embedTableauViz.js';
import {
  PREVIEW_FRAME_CLASS,
  PREVIEW_WRAPPER_CLASS,
  renderDashboardPreview,
} from './renderDashboardPreview.js';

describe('renderDashboardPreview', () => {
  beforeEach(() => {
    const container = document.createElement('div');
    container.id = TABLEAU_VIZ_CONTAINER_ID;
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it('inserts a sandboxed srcdoc iframe carrying the html', () => {
    const html = '<h1>My Dashboard</h1><script>console.log("hi")</script>';
    const inserted = renderDashboardPreview(html);

    expect(inserted).toBe(true);
    const container = document.getElementById(TABLEAU_VIZ_CONTAINER_ID)!;
    const frame = container.querySelector<HTMLIFrameElement>(`.${PREVIEW_FRAME_CLASS}`);
    expect(frame).toBeTruthy();
    expect(frame!.tagName).toBe('IFRAME');
    // The html is carried inline via srcdoc — never as a network src.
    expect(frame!.getAttribute('srcdoc')).toBe(html);
    expect(frame!.hasAttribute('src')).toBe(false);
  });

  it('sandboxes with allow-scripts ONLY — never allow-same-origin', () => {
    renderDashboardPreview('<p>hi</p>');
    const frame = document
      .getElementById(TABLEAU_VIZ_CONTAINER_ID)!
      .querySelector<HTMLIFrameElement>(`.${PREVIEW_FRAME_CLASS}`)!;

    const sandbox = frame.getAttribute('sandbox');
    expect(sandbox).toBe('allow-scripts');
    // The whole security model depends on the child NOT sharing our origin.
    expect(sandbox).not.toContain('allow-same-origin');
    // No escape hatches.
    expect(sandbox).not.toContain('allow-top-navigation');
    expect(sandbox).not.toContain('allow-popups');
  });

  it('prepends the preview so a previously-rendered card is preserved above/below', () => {
    const container = document.getElementById(TABLEAU_VIZ_CONTAINER_ID)!;
    // Simulate the card renderer having run first (it uses replaceChildren(card)).
    const card = document.createElement('a');
    card.className = 'pub-card';
    container.replaceChildren(card);

    renderDashboardPreview('<p>preview</p>');

    // Both survive; preview is first (on top), card second.
    expect(container.children).toHaveLength(2);
    expect(container.children[0].className).toBe(PREVIEW_WRAPPER_CLASS);
    expect(container.children[1].className).toBe('pub-card');
  });

  it('returns false when the container is absent (no throw)', () => {
    document.body.replaceChildren(); // remove the container
    expect(renderDashboardPreview('<p>x</p>')).toBe(false);
  });
});
