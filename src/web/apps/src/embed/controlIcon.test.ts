/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';

import { createControlIcon } from './controlIcon.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

describe('createControlIcon', () => {
  it('builds an aria-hidden .viz-control-icon svg wrapping a use with the given href', () => {
    const icon = createControlIcon('#fullscreen-icon');

    // The svg element itself is namespaced, classed, and hidden from the a11y tree.
    expect(icon.namespaceURI).toBe(SVG_NS);
    expect(icon.tagName.toLowerCase()).toBe('svg');
    expect(icon.getAttribute('class')).toBe('viz-control-icon');
    expect(icon.getAttribute('aria-hidden')).toBe('true');

    // It contains exactly one <use> pointing at the sprite symbol via xlink:href.
    const use = icon.querySelector('use');
    expect(use).not.toBeNull();
    expect(use?.namespaceURI).toBe(SVG_NS);
    expect(use?.getAttributeNS(XLINK_NS, 'href')).toBe('#fullscreen-icon');
  });

  it('uses the exact href passed by the caller', () => {
    const icon = createControlIcon('#external-icon');

    expect(icon.querySelector('use')?.getAttributeNS(XLINK_NS, 'href')).toBe('#external-icon');
  });

  it('returns a detached element (not yet attached to the DOM)', () => {
    const icon = createControlIcon('#fullscreen-icon');

    expect(icon.parentNode).toBeNull();
  });
});
