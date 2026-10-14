const OVERLAY_GROUP_ID = 'vizOverlayGroup';

/**
 * Returns the shared floating overlay pill inside `#vizStage`, creating it if absent.
 *
 * Both the "Open in Tableau" link and the "Fullscreen" button live in this single
 * `.overlay-group` so they render as one segmented control floating over the viz's
 * bottom-right corner. The pill lives in `#vizStage` (a SIBLING of the viz container)
 * — NOT inside `#tableauVizContainer` — so it survives `embedTableauViz`'s
 * `replaceChildren` on the viz container during (re-)embed.
 *
 * @param container - The `.main` element.
 * @returns The overlay group element, or null if `#vizStage` is missing (callers
 *   should fall back to appending directly to the container).
 */
export function getOrCreateOverlayGroup(container: HTMLElement): HTMLElement | null {
  const vizStage = container.querySelector('#vizStage');
  if (!vizStage) {
    return null;
  }

  let group = vizStage.querySelector<HTMLElement>(`#${OVERLAY_GROUP_ID}`);
  if (!group) {
    group = document.createElement('div');
    group.id = OVERLAY_GROUP_ID;
    group.className = 'overlay-group';
    vizStage.appendChild(group);
  }
  return group;
}
