const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

/**
 * The sprite symbols an overlay control may reference, as `<use xlink:href>` values.
 * These are the only `<symbol>` ids defined in the sprite sheet in `mcp-app.html`, so
 * this closed union keeps callers from referencing a symbol that would render blank.
 */
export type ControlIconHref = '#fullscreen-icon' | '#external-icon';

/**
 * Builds an overlay-control icon: an `aria-hidden` `.viz-control-icon` `<svg>` that
 * references a sprite symbol via an `<use xlink:href>`. Shared by the fullscreen button
 * and the Open-in-Tableau link so the icon markup lives in exactly one place.
 *
 * @param symbolHref - The sprite symbol reference, including the leading `#`
 *   (e.g. `'#fullscreen-icon'`, `'#external-icon'`).
 * @returns The assembled `<svg>` icon, not yet attached to the DOM.
 */
export function createControlIcon(symbolHref: ControlIconHref): SVGSVGElement {
  const icon = document.createElementNS(SVG_NS, 'svg');
  icon.setAttribute('class', 'viz-control-icon');
  icon.setAttribute('aria-hidden', 'true');

  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttributeNS(XLINK_NS, 'xlink:href', symbolHref);
  icon.appendChild(use);

  return icon;
}
