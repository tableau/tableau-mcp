// src/desktop/route/route-state.ts
//
// SESSION-KEYED route state (Slice B, adapted from a2td src/server/route-state.ts). tmcp has
// NO episode subsystem, so the a2td per-EPISODE record is ported onto the resolved Desktop
// SESSION id instead. The `recordBindAttempt` / `recordRefineAttempt` episode integration is
// deliberately DROPPED (there is no begin-episode/end-episode lifecycle to hang it on); the
// one-shot deflection invariant is enforced per (session, ask) by the deflection/override
// records here rather than by attempt counters.
//
// In-memory, per-server-process (a module singleton, same lifetime as SessionManager). The
// gate (`route-gate.ts`) is the only writer; readers are tests and any future receipt surface.
// `current_ask` additionally records the most recent bind-template ask classification for a
// session so no-ask scratch-entry tools can fail-open or one-shot-deflect without reclassifying.

import type { AskShape, RouteClass } from '../binder/route-spec.js';

export type { AskShape, RouteClass };

/**
 * A deflection issued by the gate. Carries the {tool, ts} receipt shape plus the issued
 * next_route marker, the one-line agent-actionable text, and the normalized ask KEY it was
 * issued for (the per-session one-shot dedup key — a2td used the episode id).
 */
export interface RouteDeflection {
  /** The scratch-entry tool whose call was deflected. */
  tool: string;
  /** ISO timestamp the deflection was issued. */
  ts: string;
  /** The normalized ask key the deflection was issued for (one-shot dedup within a session). */
  ask: string;
  /** The eligible template the deflection names, for bind-first deflections. */
  template?: string;
  /** The classified refine shape the deflection names, for refine-op deflections. */
  shape?: AskShape;
  /** The route the deflection steers the agent toward. */
  next_route: RouteClass;
  /** One line of agent-actionable text (the deflection result body). */
  text: string;
}

/**
 * A recorded route override: a SECOND scratch-entry call for a (session, ask) already
 * deflected, allowed to execute (the one-shot invariant — never deflect twice).
 */
export interface RouteOverride {
  /** The scratch-entry tool whose call was allowed to execute post-deflection. */
  tool: string;
  /** ISO timestamp the override was recorded. */
  ts: string;
  /** The normalized ask key the prior deflection was issued for. */
  ask: string;
  /** The eligible template the prior deflection named, for bind-first overrides. */
  template?: string;
  /** The classified refine shape the prior deflection named, for refine-op overrides. */
  shape?: AskShape;
}

/** Terminal dispositions a bind-template call can produce (mirrors BinderResult.status). */
export type BindOutcome = 'bound' | 'propose' | 'escalate';

/**
 * The MOST RECENT ask bind-template classified for this session (most-recent-ask-wins).
 * `last_outcome` is null between classification and the concluded bind-template outcome.
 */
export interface SessionAskClassification {
  /** Normalized ask key (via normalizeAskForMatch), the one-shot dedup key. */
  ask: string;
  route: RouteClass;
  shape: AskShape;
  template: string | null;
  /** ISO timestamp classification was recorded. */
  ts: string;
  /** null until recordAskOutcome fills it in. */
  last_outcome: BindOutcome | null;
}

export interface SessionRouteState {
  /** The resolved Desktop session id this state is keyed by. */
  session_id: string;
  /** Deflections issued for this session by the gate. */
  deflections: RouteDeflection[];
  /** Route overrides recorded for this session (one per (session, ask) post-deflection). */
  route_overrides: RouteOverride[];
  /** Most recent bind-template ask classification for this session, if any. */
  current_ask?: SessionAskClassification;
}

export class SessionRouteStateStore {
  private bySession = new Map<string, SessionRouteState>();

  /**
   * Safety cap on retained session states. A long-lived server that never sees an
   * end-of-session signal would otherwise leak; keeping only the newest ~500 states bounds
   * memory. A Map iterates in insertion order, so the oldest live key evicts first.
   */
  static readonly MAX_STATES = 500;

  /**
   * Per-session cap on each record array. A marathon session with enforcement on would
   * otherwise grow one entry per unique ask, unbounded. FIFO eviction: past the cap, the
   * one-shot invariant weakens to "at most twice" for the evicted (oldest) asks — benign
   * next to unbounded memory.
   */
  static readonly MAX_ENTRIES_PER_SESSION = 200;

  private ensure(sessionId: string): SessionRouteState {
    let state = this.bySession.get(sessionId);
    if (!state) {
      state = { session_id: sessionId, deflections: [], route_overrides: [] };
      this.bySession.set(sessionId, state);
      while (this.bySession.size > SessionRouteStateStore.MAX_STATES) {
        const oldest = this.bySession.keys().next().value;
        if (oldest === undefined) break;
        this.bySession.delete(oldest);
      }
    }
    return state;
  }

  /** Route state for a session, if any. Undefined for an unknown/absent id (no-op). */
  get(sessionId: string | undefined): SessionRouteState | undefined {
    if (!sessionId) return undefined;
    return this.bySession.get(sessionId);
  }

  /**
   * Whether a deflection was already issued for this (session, ask). The one-shot invariant:
   * once true, the gate overrides (executes) instead of deflecting again.
   */
  hasDeflection(sessionId: string | undefined, ask: string): boolean {
    const state = this.get(sessionId);
    return !!state && state.deflections.some((d) => d.ask === ask);
  }

  /** Whether an override was already recorded for this (session, ask). */
  hasOverride(sessionId: string | undefined, ask: string): boolean {
    const state = this.get(sessionId);
    return !!state && state.route_overrides.some((o) => o.ask === ask);
  }

  /**
   * Record a deflection issued by the gate. Lazy-inits the session state on first write. No
   * episode/begin-episode init is needed (or exists) in the session-keyed world. No-op on a
   * missing session id (fail-open).
   */
  recordDeflection(
    sessionId: string | undefined,
    deflection: RouteDeflection,
  ): SessionRouteState | undefined {
    if (!sessionId) return undefined;
    const state = this.ensure(sessionId);
    state.deflections.push(deflection);
    while (state.deflections.length > SessionRouteStateStore.MAX_ENTRIES_PER_SESSION) {
      state.deflections.shift();
    }
    return state;
  }

  /**
   * Record a route override (a post-deflection execution). Same fail-open contract as
   * recordDeflection; lazy-inits the session state if somehow absent.
   */
  recordOverride(
    sessionId: string | undefined,
    override: RouteOverride,
  ): SessionRouteState | undefined {
    if (!sessionId) return undefined;
    const state = this.ensure(sessionId);
    state.route_overrides.push(override);
    while (state.route_overrides.length > SessionRouteStateStore.MAX_ENTRIES_PER_SESSION) {
      state.route_overrides.shift();
    }
    return state;
  }

  /**
   * Record the classification of an ask just received by bind-template. Overwrites any prior
   * current_ask (most-recent-ask-wins). No-op on a missing session id (fail-open).
   */
  recordAskClassification(
    sessionId: string | undefined,
    classification: Omit<SessionAskClassification, 'ts' | 'last_outcome'>,
  ): SessionRouteState | undefined {
    if (!sessionId) return undefined;
    const state = this.ensure(sessionId);
    state.current_ask = {
      ...classification,
      ts: new Date().toISOString(),
      last_outcome: null,
    };
    return state;
  }

  /**
   * Record the concluded outcome for the CURRENT current_ask. If a later ask overwrote the slot,
   * silently drop the stale outcome instead of mutating the wrong ask's record.
   */
  recordAskOutcome(
    sessionId: string | undefined,
    ask: string,
    outcome: BindOutcome,
  ): SessionRouteState | undefined {
    const state = this.get(sessionId);
    if (!state?.current_ask || state.current_ask.ask !== ask) return undefined;
    state.current_ask.last_outcome = outcome;
    return state;
  }

  /**
   * Drop the current_ask slot — bind-template's fail-open escape hatch. A bind that THREW
   * (outcome unknowable) or a classification fault must never leave a pending
   * "no bind attempt yet" record for the gate to deflect on later; absent state fail-opens.
   * With `ask` supplied, clears only when the slot still holds that ask (a later ask's
   * record is never clobbered); without it, clears unconditionally (a new ask arriving on a
   * classification fault invalidates whatever was pending). No-op on a missing session.
   */
  clearCurrentAsk(sessionId: string | undefined, ask?: string): boolean {
    const state = this.get(sessionId);
    if (!state?.current_ask) return false;
    if (ask !== undefined && state.current_ask.ask !== ask) return false;
    delete state.current_ask;
    return true;
  }

  /** Evict a session's route state. No-op (false) on a missing/unknown id (fail-open). */
  evict(sessionId: string | undefined): boolean {
    if (!sessionId) return false;
    return this.bySession.delete(sessionId);
  }

  /** Test/reset helper. */
  clear(): void {
    this.bySession.clear();
  }
}

/**
 * Process-wide singleton (one MCP server == one process, same lifetime as SessionManager).
 * A module singleton — not a server field — because the gate call sites import it directly.
 */
export const sessionRouteState = new SessionRouteStateStore();
