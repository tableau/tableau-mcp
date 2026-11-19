import React, { type ReactElement } from 'react';

/**
 * Lightweight "opens in a new tab" glyph shown after external links.
 *
 * Sized to 2/3 of the surrounding text (0.667em) and drawn with thin,
 * dimmed strokes in `currentColor` so it hints that a link leaves the site
 * without drawing attention away from the link text itself.
 */
export default function ExtLink(): ReactElement {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="0.667em"
      height="0.667em"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label="(opens in a new tab)"
      style={{ marginLeft: '0.15em', verticalAlign: '-0.1em', opacity: 0.6 }}
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}
