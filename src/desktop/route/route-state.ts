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

export type BindRecoveryPhase =
  | 'awaiting-proposal'
  | 'proposal-attempted'
  | 'retry-used'
  | 'terminal';

export interface BindAttempt {
  /** ISO timestamp the bind recovery observation was recorded. */
  ts: string;
  /** Store-scoped reservation id returned by admission; outcome recording uses it to correlate concurrency. */
  reservationId?: number;
  /** Absent while an admitted call is still in flight or failed before a binder outcome. */
  outcome?: BindOutcome;
  /** Canonical semantic signature for proposal-bearing calls. */
  proposalSignature?: string;
  /** True only for the single changed-proposal retry after the first proposal-bearing call. */
  consumesRetryBudget: boolean;
}

export interface BindRecoveryRecord {
  phase: BindRecoveryPhase;
  attempts: BindAttempt[];
  lastProposalSignature?: string;
  /** Outcome records that could not be correlated to a live pending reservation. */
  uncorrelatedOutcomeCount?: number;
}

export interface BindRecoveryAttemptInput {
  outcome: BindOutcome;
  proposalSignature?: string;
  reservationId?: number;
  /** Explicit terminal-done marker; callers use this only after final bind processing concludes. */
  terminal?: boolean;
}

export interface BindRecoveryAdmissionInput {
  proposalSignature?: string;
}

export interface UnprotectedPassthroughs {
  count: number;
  last_asks: string[];
}

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
  /** Bounded per-ask bind recovery records, keyed by the same normalized ask as current_ask. */
  bindRecoveryByAsk: Map<string, BindRecoveryRecord>;
  /** Capacity-rejected bind admissions that intentionally proceeded unprotected. */
  unprotected_passthroughs: UnprotectedPassthroughs;
  /** Most recent bind-template ask classification for this session, if any. */
  current_ask?: SessionAskClassification;
}

export interface RouteReceipt {
  route?: RouteClass;
  shape?: AskShape;
  template?: string;
  bind_attempts?: {
    count: number;
    outcomes: BindOutcome[];
    phase?: BindRecoveryPhase;
    retry_budget_consumed?: number;
    uncorrelated_outcomes?: number;
  };
  deflections?: Array<{
    tool: string;
    ts: string;
    template?: string;
    shape?: AskShape;
    next_route: RouteClass;
  }>;
  route_overrides?: Array<{
    tool: string;
    ts: string;
    template?: string;
    shape?: AskShape;
  }>;
  unprotected_passthroughs?: UnprotectedPassthroughs;
}

export function serializeRouteReceipt(
  state: SessionRouteState | undefined,
): RouteReceipt | undefined {
  if (!state) return undefined;
  const receipt: RouteReceipt = {};
  if (state.current_ask) {
    const bindRecovery = state.bindRecoveryByAsk.get(state.current_ask.ask);
    receipt.route = state.current_ask.route;
    receipt.shape = state.current_ask.shape;
    receipt.template = state.current_ask.template ?? undefined;
    if (bindRecovery) {
      receipt.bind_attempts = {
        count: bindRecovery.attempts.length,
        outcomes: bindRecovery.attempts.flatMap((attempt) =>
          attempt.outcome === undefined ? [] : [attempt.outcome],
        ),
        phase: bindRecovery.phase,
        retry_budget_consumed: bindRecovery.attempts.filter(
          (attempt) => attempt.consumesRetryBudget,
        ).length,
        ...(bindRecovery.uncorrelatedOutcomeCount
          ? { uncorrelated_outcomes: bindRecovery.uncorrelatedOutcomeCount }
          : {}),
      };
    } else {
      receipt.bind_attempts = {
        count: state.current_ask.last_outcome === null ? 0 : 1,
        outcomes: state.current_ask.last_outcome === null ? [] : [state.current_ask.last_outcome],
      };
    }
  }
  if (state.deflections.length > 0) {
    receipt.deflections = state.deflections.map((deflection) => ({
      tool: deflection.tool,
      ts: deflection.ts,
      template: deflection.template,
      shape: deflection.shape,
      next_route: deflection.next_route,
    }));
  }
  if (state.route_overrides.length > 0) {
    receipt.route_overrides = state.route_overrides.map((override) => ({
      tool: override.tool,
      ts: override.ts,
      template: override.template,
      shape: override.shape,
    }));
  }
  if (state.unprotected_passthroughs.count > 0) {
    receipt.unprotected_passthroughs = {
      count: state.unprotected_passthroughs.count,
      last_asks: [...state.unprotected_passthroughs.last_asks],
    };
  }
  return Object.keys(receipt).length > 0 ? receipt : undefined;
}

export class SessionRouteStateStore {
  private bySession = new Map<string, SessionRouteState>();

  private nextBindRecoveryReservationId = 0;

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

  /** Per-session LRU cap for bind recovery records. */
  static readonly MAX_BIND_RECOVERY_ASKS = 8;

  /** Receipt cap for capacity-rejected asks. */
  static readonly MAX_UNPROTECTED_PASSTHROUGH_ASKS = 4;

  private ensure(sessionId: string): SessionRouteState {
    let state = this.bySession.get(sessionId);
    if (!state) {
      state = {
        session_id: sessionId,
        deflections: [],
        route_overrides: [],
        bindRecoveryByAsk: new Map(),
        unprotected_passthroughs: { count: 0, last_asks: [] },
      };
      this.bySession.set(sessionId, state);
      while (this.bySession.size > SessionRouteStateStore.MAX_STATES) {
        const oldest = this.bySession.keys().next().value;
        if (oldest === undefined) break;
        this.bySession.delete(oldest);
      }
    }
    return state;
  }

  private isActiveBindRecovery(record: BindRecoveryRecord): boolean {
    return record.phase !== 'terminal';
  }

  private touchBindRecovery(
    state: SessionRouteState,
    ask: string,
    record: BindRecoveryRecord,
  ): boolean {
    state.bindRecoveryByAsk.delete(ask);
    state.bindRecoveryByAsk.set(ask, record);
    while (state.bindRecoveryByAsk.size > SessionRouteStateStore.MAX_BIND_RECOVERY_ASKS) {
      const terminalAsk = [...state.bindRecoveryByAsk.entries()].find(
        ([candidateAsk, candidateRecord]) =>
          candidateAsk !== ask && !this.isActiveBindRecovery(candidateRecord),
      )?.[0];
      if (terminalAsk !== undefined) {
        state.bindRecoveryByAsk.delete(terminalAsk);
        continue;
      }

      const selfIsTerminal = !this.isActiveBindRecovery(record);
      if (selfIsTerminal) {
        state.bindRecoveryByAsk.delete(ask);
        return false;
      }

      state.bindRecoveryByAsk.delete(ask);
      return false;
    }
    return true;
  }

  private recordUnprotectedPassthrough(state: SessionRouteState, ask: string): void {
    state.unprotected_passthroughs.count += 1;
    state.unprotected_passthroughs.last_asks.push(ask);
    while (
      state.unprotected_passthroughs.last_asks.length >
      SessionRouteStateStore.MAX_UNPROTECTED_PASSTHROUGH_ASKS
    ) {
      state.unprotected_passthroughs.last_asks.shift();
    }
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

  /** Bind recovery record for a session/normalized-ask pair, if retained. */
  getBindRecovery(sessionId: string | undefined, ask: string): BindRecoveryRecord | undefined {
    const state = this.get(sessionId);
    const record = state?.bindRecoveryByAsk.get(ask);
    if (state && record) {
      this.touchBindRecovery(state, ask, record);
    }
    return record;
  }

  private classifyBindRecoveryPhase(
    previous: BindRecoveryRecord | undefined,
    proposalSignature: string | undefined,
  ): Pick<BindAttempt, 'consumesRetryBudget'> & { phase: BindRecoveryPhase } {
    const hasProposal = proposalSignature !== undefined;
    const priorProposalSignature = previous?.lastProposalSignature;
    const changedProposal =
      hasProposal &&
      priorProposalSignature !== undefined &&
      priorProposalSignature !== proposalSignature;

    const consumesRetryBudget = previous?.phase === 'proposal-attempted' && changedProposal;
    const phase: BindRecoveryPhase = !hasProposal
      ? 'awaiting-proposal'
      : consumesRetryBudget || previous?.phase === 'retry-used'
        ? 'retry-used'
        : 'proposal-attempted';

    return { phase, consumesRetryBudget };
  }

  private withLastProposalSignature(
    previous: BindRecoveryRecord | undefined,
    proposalSignature: string | undefined,
  ): Pick<BindRecoveryRecord, 'lastProposalSignature'> {
    if (proposalSignature !== undefined) return { lastProposalSignature: proposalSignature };
    if (previous?.lastProposalSignature !== undefined) {
      return { lastProposalSignature: previous.lastProposalSignature };
    }
    return {};
  }

  private upgradesLastReservation(
    previous: BindRecoveryRecord | undefined,
    proposalSignature: string | undefined,
  ): boolean {
    const lastAttempt = previous?.attempts.at(-1);
    return (
      lastAttempt !== undefined &&
      lastAttempt.outcome === undefined &&
      lastAttempt.proposalSignature === proposalSignature
    );
  }

  private upgradeReservedAttempt(
    previous: BindRecoveryRecord | undefined,
    reservationId: number,
    bindAttempt: BindAttempt & { outcome: BindOutcome },
  ): { attempts: BindAttempt[]; uncorrelated: boolean } {
    const previousAttempts = previous?.attempts ?? [];
    const reservedAttemptIndex = previousAttempts.findIndex(
      (attempt) => attempt.reservationId === reservationId,
    );
    if (reservedAttemptIndex === -1) {
      return {
        attempts: previousAttempts,
        uncorrelated: true,
      };
    }
    const reservedAttempt = previousAttempts[reservedAttemptIndex];
    if (reservedAttempt.outcome !== undefined) {
      return {
        attempts: previousAttempts,
        uncorrelated: true,
      };
    }

    const attempts = previousAttempts.slice();
    attempts[reservedAttemptIndex] = {
      ...reservedAttempt,
      outcome: bindAttempt.outcome,
    };
    return { attempts, uncorrelated: false };
  }

  private upgradeOrAppendAttempt(
    previous: BindRecoveryRecord | undefined,
    proposalSignature: string | undefined,
    bindAttempt: BindAttempt & { outcome: BindOutcome },
  ): BindAttempt[] {
    if (!this.upgradesLastReservation(previous, proposalSignature)) {
      return [...(previous?.attempts ?? []), bindAttempt];
    }
    const previousAttempts = previous?.attempts ?? [];
    const lastAttempt = previousAttempts.at(-1);
    if (!lastAttempt) return [bindAttempt];
    return [...previousAttempts.slice(0, -1), { ...lastAttempt, outcome: bindAttempt.outcome }];
  }

  private withUncorrelatedOutcomeCount(
    previous: BindRecoveryRecord | undefined,
    uncorrelated: boolean,
  ): Pick<BindRecoveryRecord, 'uncorrelatedOutcomeCount'> {
    const count = (previous?.uncorrelatedOutcomeCount ?? 0) + (uncorrelated ? 1 : 0);
    return count > 0 ? { uncorrelatedOutcomeCount: count } : {};
  }

  /**
   * Atomically admit a bind recovery call before any downstream work. The reservation itself
   * enforces in-flight duplicate blocking; later outcome recording upgrades this reservation id.
   */
  reserveBindRecoveryAdmission(
    sessionId: string | undefined,
    ask: string,
    admission: BindRecoveryAdmissionInput,
  ): number | undefined {
    if (!sessionId) return undefined;
    const state = this.ensure(sessionId);
    const previous = state.bindRecoveryByAsk.get(ask);
    const { phase, consumesRetryBudget } = this.classifyBindRecoveryPhase(
      previous,
      admission.proposalSignature,
    );
    const bindAttempt: BindAttempt = {
      ts: new Date().toISOString(),
      ...(admission.proposalSignature !== undefined
        ? { proposalSignature: admission.proposalSignature }
        : {}),
      consumesRetryBudget,
    };
    const reservationId = this.nextBindRecoveryReservationId++;
    const record: BindRecoveryRecord = {
      phase,
      attempts: [...(previous?.attempts ?? []), { ...bindAttempt, reservationId }],
      ...this.withLastProposalSignature(previous, admission.proposalSignature),
      ...this.withUncorrelatedOutcomeCount(previous, false),
    };

    if (this.touchBindRecovery(state, ask, record)) {
      return reservationId;
    }
    this.recordUnprotectedPassthrough(state, ask);
    return undefined;
  }

  /**
   * Record one bind recovery observation for a normalized ask. This is separate from
   * current_ask so the scratch gate keeps its most-recent pending-call semantics.
   */
  recordBindRecoveryAttempt(
    sessionId: string | undefined,
    ask: string,
    attempt: BindRecoveryAttemptInput,
  ): SessionRouteState | undefined {
    if (!sessionId) return undefined;
    const state = this.ensure(sessionId);

    if (attempt.terminal) {
      state.bindRecoveryByAsk.delete(ask);
      return state;
    }

    const previous = state.bindRecoveryByAsk.get(ask);
    const { phase, consumesRetryBudget } = this.classifyBindRecoveryPhase(
      previous,
      attempt.proposalSignature,
    );

    const bindAttempt: BindAttempt & { outcome: BindOutcome } = {
      ts: new Date().toISOString(),
      outcome: attempt.outcome,
      ...(attempt.reservationId !== undefined ? { reservationId: attempt.reservationId } : {}),
      ...(attempt.proposalSignature !== undefined
        ? { proposalSignature: attempt.proposalSignature }
        : {}),
      consumesRetryBudget,
    };
    const upgraded =
      attempt.reservationId === undefined
        ? {
            attempts: this.upgradeOrAppendAttempt(previous, attempt.proposalSignature, bindAttempt),
            uncorrelated: false,
          }
        : this.upgradeReservedAttempt(previous, attempt.reservationId, bindAttempt);
    const record: BindRecoveryRecord = {
      phase: upgraded.uncorrelated && previous ? previous.phase : phase,
      attempts: upgraded.attempts,
      ...this.withLastProposalSignature(
        previous,
        attempt.reservationId === undefined ? attempt.proposalSignature : undefined,
      ),
      ...this.withUncorrelatedOutcomeCount(previous, upgraded.uncorrelated),
    };

    this.touchBindRecovery(state, ask, record);
    return state;
  }

  /**
   * Record a non-recoverable bind end-state that should block future same-ask retries.
   * This is distinct from `terminal: true`, which clears successful done/bound records.
   */
  recordBindRecoveryTerminal(
    sessionId: string | undefined,
    ask: string,
    attempt: Omit<BindRecoveryAttemptInput, 'terminal'>,
  ): SessionRouteState | undefined {
    if (!sessionId) return undefined;
    const state = this.ensure(sessionId);
    const previous = state.bindRecoveryByAsk.get(ask);
    const { consumesRetryBudget } = this.classifyBindRecoveryPhase(
      previous,
      attempt.proposalSignature,
    );
    const bindAttempt: BindAttempt & { outcome: BindOutcome } = {
      ts: new Date().toISOString(),
      outcome: attempt.outcome,
      ...(attempt.reservationId !== undefined ? { reservationId: attempt.reservationId } : {}),
      ...(attempt.proposalSignature !== undefined
        ? { proposalSignature: attempt.proposalSignature }
        : {}),
      consumesRetryBudget,
    };
    const upgraded =
      attempt.reservationId === undefined
        ? {
            attempts: this.upgradeOrAppendAttempt(previous, attempt.proposalSignature, bindAttempt),
            uncorrelated: false,
          }
        : this.upgradeReservedAttempt(previous, attempt.reservationId, bindAttempt);
    const record: BindRecoveryRecord = {
      phase: upgraded.uncorrelated && previous ? previous.phase : 'terminal',
      attempts: upgraded.attempts,
      ...this.withLastProposalSignature(
        previous,
        attempt.reservationId === undefined ? attempt.proposalSignature : undefined,
      ),
      ...this.withUncorrelatedOutcomeCount(previous, upgraded.uncorrelated),
    };

    this.touchBindRecovery(state, ask, record);
    return state;
  }

  clearBindRecovery(sessionId: string | undefined, ask: string): boolean {
    const state = this.get(sessionId);
    if (!state) return false;
    return state.bindRecoveryByAsk.delete(ask);
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
