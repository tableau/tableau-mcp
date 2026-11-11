// Per-session last-tool trace for the route breadcrumb (nextStep.ts): the preceding tool is the
// next-step disambiguator, which the coarse, sticky ask classification can't provide. In-memory
// singleton keyed by the raw `session` arg; observational, so a miss just means no breadcrumb.

import { DesktopToolName } from '../../tools/desktop/toolName.js';

/** Session cap guarding against a process leak if sessions are never torn down (oldest-first eviction). */
const MAX_TRACKED_SESSIONS = 1024;

const lastToolBySession = new Map<string, DesktopToolName>();

export const sessionLastTool = {
  /** The last successful tool recorded for this resolved session, or undefined. */
  get(sessionId: string | undefined): DesktopToolName | undefined {
    if (!sessionId) return undefined;
    return lastToolBySession.get(sessionId);
  },

  /** Record the last successful tool for this resolved session. No-op without a session id. */
  set(sessionId: string | undefined, tool: DesktopToolName): void {
    if (!sessionId) return;
    // Re-insert to mark most-recently-used; evict the oldest entry past the cap.
    lastToolBySession.delete(sessionId);
    lastToolBySession.set(sessionId, tool);
    if (lastToolBySession.size > MAX_TRACKED_SESSIONS) {
      const oldest = lastToolBySession.keys().next().value;
      if (oldest !== undefined) lastToolBySession.delete(oldest);
    }
  },

  /** Test seam: drop all tracked sessions. */
  reset(): void {
    lastToolBySession.clear();
  },
};
