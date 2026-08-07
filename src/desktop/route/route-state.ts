// src/desktop/route/route-state.ts
//
// SESSION-KEYED bind recovery and route receipts.
//
// In-memory, per-server-process (a module singleton, same lifetime as SessionManager). The
// `current_ask` records the most recent bind-template classification and outcome for telemetry;
// it never blocks an authoring tool.

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

/** Maximum genuinely distinct proposal corrections retained for one normalized ask. */
export const MAX_BIND_RECOVERY_PROPOSAL_SIGNATURES = 8;

/** One reminder is allowed; a second consecutive bare resubmit terminates bind recovery. */
export const MAX_CONSECUTIVE_BIND_RECOVERY_BARE_RESUBMITS = 2;

/** Full-profile binder discriminator retained as state data, never rendered as recovery text. */
export const LEGACY_BIND_TEMPLATE_TOOL = 'bind-template' as const;

/** Actionable Call-2 choices retained so a repeated bare ask does not lose the proposal payload. */
export interface BindRecoveryProposalContext {
  tool: typeof LEGACY_BIND_TEMPLATE_TOOL;
  arguments: {
    session: string;
    ask: string;
    target_worksheet?: string;
    auto_apply: true;
  };
  recommended?: {
    measure: string;
    top_n: number;
    reason: string;
    context_measures: string[];
    binding: {
      template: string;
      bindings: Array<{ slot_id: string; field: string }>;
    };
  };
  proposal_choices: Array<{
    template: string;
    slots: Array<{
      slot_id: string;
      required: boolean;
      compatible_field_names: string[];
      compatible_field_options?: Array<{ name: string; label: string }>;
    }>;
  }>;
  proposal_requirements: {
    title: string;
    confidence: string;
    field_selection: string;
  };
}

export interface BindAttempt {
  /** ISO timestamp the bind recovery observation was recorded. */
  ts: string;
  /** Store-scoped reservation id returned by admission; outcome recording uses it to correlate concurrency. */
  reservationId?: number;
  /** Absent while an admitted call is still in flight or failed before a binder outcome. */
  outcome?: BindOutcome;
  /** Canonical semantic signature for proposal-bearing calls. */
  proposalSignature?: string;
  /** True for each genuinely new changed proposal after the first proposal-bearing call. */
  consumesRetryBudget: boolean;
}

export interface BindRecoveryRecord {
  phase: BindRecoveryPhase;
  attempts: BindAttempt[];
  lastProposalSignature?: string;
  proposalContext?: BindRecoveryProposalContext;
  consecutiveBareResubmitCount?: number;
  /** One repair may re-enter a Tier-2 terminal record by binding its sole missing slot. */
  terminalRepairAllowance?: {
    template: string;
    slotId: string;
    remaining: 0 | 1;
  };
  /** One-shot retry for an apply failure proven to have occurred before mutation dispatch. */
  preDispatchRetryAllowance?: {
    proposalSignature: string;
    remaining: 0 | 1;
  };
  /** Outcome records that could not be correlated to a live pending reservation. */
  uncorrelatedOutcomeCount?: number;
}

export interface BindRecoveryAttemptInput {
  outcome: BindOutcome;
  proposalSignature?: string;
  proposalContext?: BindRecoveryProposalContext;
  reservationId?: number;
  terminalRepairAllowance?: BindRecoveryRecord['terminalRepairAllowance'];
  /** Explicit terminal-done marker; callers use this only after final bind processing concludes. */
  terminal?: boolean;
}

export interface BindRecoveryAdmissionInput {
  proposalSignature?: string;
}

export type BindProposalProgress = 'new' | 'repeat' | 'limit';

/**
 * Classify whether a proposal signature advances recovery or cycles prior work. Distinct
 * corrections fail open until the bounded cap; any previously seen signature is loop evidence.
 */
export function classifyBindProposalProgress(
  record: BindRecoveryRecord | undefined,
  proposalSignature: string,
): BindProposalProgress {
  const distinctSignatures = new Set(
    (record?.attempts ?? []).flatMap((attempt) =>
      attempt.proposalSignature === undefined ? [] : [attempt.proposalSignature],
    ),
  );
  if (distinctSignatures.has(proposalSignature)) return 'repeat';
  return distinctSignatures.size >= MAX_BIND_RECOVERY_PROPOSAL_SIGNATURES ? 'limit' : 'new';
}

export interface UnprotectedPassthroughs {
  count: number;
  last_asks: string[];
}

/** One sheet bind-template already applied in this session, keyed by its render signature. */
export interface AppliedSheetRecord {
  /** The sheet name actually written to the workbook. */
  sheetName: string;
  /** The bound template, for the reuse receipt. */
  template: string;
  /** ISO timestamp of the apply. */
  ts: string;
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
  /** Consecutive transient get-summary-data failures keyed by argument signature. */
  summaryDataTransientFailures: Map<string, number>;
  /** Capacity-rejected bind admissions that intentionally proceeded unprotected. */
  unprotected_passthroughs: UnprotectedPassthroughs;
  /** Sheets applied by bind-template in this session, keyed by render signature. */
  appliedSheets: Map<string, AppliedSheetRecord>;
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

  /**
   * Per-session LRU cap for get-summary-data transient-failure counters. Rotating more than
   * this many failing signatures can evict a first failure before its retry, so the terminal
   * guard is intentionally best-effort for that rare pattern in exchange for bounded memory.
   */
  static readonly MAX_SUMMARY_DATA_FAILURE_SIGNATURES = 8;

  /** Receipt cap for capacity-rejected asks. */
  static readonly MAX_UNPROTECTED_PASSTHROUGH_ASKS = 4;

  /**
   * Per-session LRU cap for applied-sheet records. Past the cap the oldest sheet is
   * forgotten, so a re-bind of it builds a duplicate again — the pre-fix behaviour, which
   * is the safe direction to fail.
   */
  static readonly MAX_APPLIED_SHEETS = 32;

  private ensure(sessionId: string): SessionRouteState {
    let state = this.bySession.get(sessionId);
    if (!state) {
      state = {
        session_id: sessionId,
        deflections: [],
        route_overrides: [],
        bindRecoveryByAsk: new Map(),
        summaryDataTransientFailures: new Map(),
        unprotected_passthroughs: { count: 0, last_asks: [] },
        appliedSheets: new Map(),
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

  /**
   * The sheet this session already applied for `signature`, if still remembered. Reading
   * refreshes LRU position so a sheet the model keeps re-asking for is not evicted first.
   */
  getAppliedSheet(
    sessionId: string | undefined,
    signature: string,
  ): AppliedSheetRecord | undefined {
    const state = this.get(sessionId);
    const record = state?.appliedSheets.get(signature);
    if (state && record) {
      state.appliedSheets.delete(signature);
      state.appliedSheets.set(signature, record);
    }
    return record;
  }

  /** Remember a sheet bind-template just applied. No-op on a missing session id (fail-open). */
  recordAppliedSheet(
    sessionId: string | undefined,
    signature: string,
    record: Omit<AppliedSheetRecord, 'ts'>,
  ): void {
    if (!sessionId) return;
    const state = this.ensure(sessionId);
    state.appliedSheets.delete(signature);
    state.appliedSheets.set(signature, { ...record, ts: new Date().toISOString() });
    while (state.appliedSheets.size > SessionRouteStateStore.MAX_APPLIED_SHEETS) {
      const oldest = state.appliedSheets.keys().next().value;
      if (oldest === undefined) break;
      state.appliedSheets.delete(oldest);
    }
  }

  /** Forget a remembered sheet — used when the live workbook no longer contains it. */
  forgetAppliedSheet(sessionId: string | undefined, signature: string): boolean {
    const state = this.get(sessionId);
    return state ? state.appliedSheets.delete(signature) : false;
  }

  /** Route state for a session, if any. Undefined for an unknown/absent id (no-op). */
  get(sessionId: string | undefined): SessionRouteState | undefined {
    if (!sessionId) return undefined;
    return this.bySession.get(sessionId);
  }

  recordSummaryDataTransientFailure(sessionId: string | undefined, signature: string): number {
    if (!sessionId) return 1;
    const state = this.ensure(sessionId);
    const count = (state.summaryDataTransientFailures.get(signature) ?? 0) + 1;
    state.summaryDataTransientFailures.delete(signature);
    state.summaryDataTransientFailures.set(signature, count);
    while (
      state.summaryDataTransientFailures.size >
      SessionRouteStateStore.MAX_SUMMARY_DATA_FAILURE_SIGNATURES
    ) {
      const oldest = state.summaryDataTransientFailures.keys().next().value;
      if (oldest === undefined) break;
      state.summaryDataTransientFailures.delete(oldest);
    }
    return count;
  }

  clearSummaryDataTransientFailure(sessionId: string | undefined, signature: string): boolean {
    const state = this.get(sessionId);
    if (!state) return false;
    return state.summaryDataTransientFailures.delete(signature);
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

  recordBindRecoveryBareResubmit(
    sessionId: string | undefined,
    ask: string,
  ): BindRecoveryRecord | undefined {
    const state = this.get(sessionId);
    const previous = state?.bindRecoveryByAsk.get(ask);
    if (!state || !previous || previous.phase === 'terminal') return previous;

    const consecutiveBareResubmitCount = (previous.consecutiveBareResubmitCount ?? 0) + 1;
    const record: BindRecoveryRecord = {
      ...previous,
      phase:
        consecutiveBareResubmitCount >= MAX_CONSECUTIVE_BIND_RECOVERY_BARE_RESUBMITS
          ? 'terminal'
          : previous.phase,
      ...this.withConsecutiveBareResubmitCount(consecutiveBareResubmitCount),
    };
    return this.touchBindRecovery(state, ask, record) ? record : undefined;
  }

  resetBindRecoveryBareResubmitCount(sessionId: string | undefined, ask: string): boolean {
    const state = this.get(sessionId);
    const previous = state?.bindRecoveryByAsk.get(ask);
    if (!state || !previous) return false;
    return this.touchBindRecovery(state, ask, {
      ...previous,
      ...this.withConsecutiveBareResubmitCount(0),
    });
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

    const consumesRetryBudget =
      changedProposal &&
      proposalSignature !== undefined &&
      classifyBindProposalProgress(previous, proposalSignature) === 'new';
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

  private withPreDispatchRetryAllowance(
    previous: BindRecoveryRecord | undefined,
    nextProposalSignature: string | undefined,
  ): Pick<BindRecoveryRecord, 'preDispatchRetryAllowance'> {
    const allowance = previous?.preDispatchRetryAllowance;
    return allowance?.proposalSignature === nextProposalSignature
      ? { preDispatchRetryAllowance: allowance }
      : {};
  }

  private withTerminalRepairAllowance(
    previous: BindRecoveryRecord | undefined,
    next?: BindRecoveryRecord['terminalRepairAllowance'],
  ): Pick<BindRecoveryRecord, 'terminalRepairAllowance'> {
    // Once consumed, the same ask cannot mint a fresh allowance by escalating again.
    const allowance = previous?.terminalRepairAllowance ?? next;
    return allowance ? { terminalRepairAllowance: allowance } : {};
  }

  private withProposalContext(
    previous: BindRecoveryRecord | undefined,
    proposalContext: BindRecoveryProposalContext | undefined,
  ): Pick<BindRecoveryRecord, 'proposalContext'> {
    if (proposalContext !== undefined) return { proposalContext };
    return previous?.proposalContext !== undefined
      ? { proposalContext: previous.proposalContext }
      : {};
  }

  private withConsecutiveBareResubmitCount(
    count: number | undefined,
  ): Pick<BindRecoveryRecord, 'consecutiveBareResubmitCount'> {
    return count === undefined ? {} : { consecutiveBareResubmitCount: count };
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
    const nextProposalSignature = admission.proposalSignature ?? previous?.lastProposalSignature;
    const record: BindRecoveryRecord = {
      phase,
      attempts: [...(previous?.attempts ?? []), { ...bindAttempt, reservationId }],
      ...this.withLastProposalSignature(previous, admission.proposalSignature),
      ...this.withProposalContext(previous, undefined),
      ...this.withConsecutiveBareResubmitCount(
        admission.proposalSignature === undefined ? previous?.consecutiveBareResubmitCount : 0,
      ),
      ...this.withPreDispatchRetryAllowance(previous, nextProposalSignature),
      ...this.withTerminalRepairAllowance(previous),
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
    const nextProposalSignature =
      attempt.reservationId === undefined
        ? (attempt.proposalSignature ?? previous?.lastProposalSignature)
        : previous?.lastProposalSignature;
    const record: BindRecoveryRecord = {
      phase: upgraded.uncorrelated && previous ? previous.phase : phase,
      attempts: upgraded.attempts,
      ...this.withLastProposalSignature(
        previous,
        attempt.reservationId === undefined ? attempt.proposalSignature : undefined,
      ),
      ...this.withProposalContext(previous, attempt.proposalContext),
      ...this.withConsecutiveBareResubmitCount(
        attempt.proposalSignature === undefined ? previous?.consecutiveBareResubmitCount : 0,
      ),
      ...this.withPreDispatchRetryAllowance(previous, nextProposalSignature),
      ...this.withTerminalRepairAllowance(previous),
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
    const nextProposalSignature =
      attempt.reservationId === undefined
        ? (attempt.proposalSignature ?? previous?.lastProposalSignature)
        : previous?.lastProposalSignature;
    const record: BindRecoveryRecord = {
      phase: upgraded.uncorrelated && previous ? previous.phase : 'terminal',
      attempts: upgraded.attempts,
      ...this.withLastProposalSignature(
        previous,
        attempt.reservationId === undefined ? attempt.proposalSignature : undefined,
      ),
      ...this.withProposalContext(previous, attempt.proposalContext),
      ...this.withConsecutiveBareResubmitCount(
        attempt.proposalSignature === undefined ? previous?.consecutiveBareResubmitCount : 0,
      ),
      ...this.withPreDispatchRetryAllowance(previous, nextProposalSignature),
      ...this.withTerminalRepairAllowance(previous, attempt.terminalRepairAllowance),
      ...this.withUncorrelatedOutcomeCount(previous, upgraded.uncorrelated),
    };

    this.touchBindRecovery(state, ask, record);
    return state;
  }

  consumeTerminalRepairAllowance(
    sessionId: string | undefined,
    ask: string,
    template: string,
    slotId: string,
  ): boolean {
    const state = this.get(sessionId);
    const record = state?.bindRecoveryByAsk.get(ask);
    const allowance = record?.terminalRepairAllowance;
    if (
      !state ||
      !record ||
      record.phase !== 'terminal' ||
      allowance?.remaining !== 1 ||
      allowance.template !== template ||
      allowance.slotId !== slotId
    ) {
      return false;
    }
    return this.touchBindRecovery(state, ask, {
      ...record,
      terminalRepairAllowance: { ...allowance, remaining: 0 },
    });
  }

  grantPreDispatchRetryAllowance(
    sessionId: string | undefined,
    ask: string,
    proposalSignature: string,
  ): boolean {
    const state = this.get(sessionId);
    const record = state?.bindRecoveryByAsk.get(ask);
    if (!state || !record || record.lastProposalSignature !== proposalSignature) return false;
    if (record.preDispatchRetryAllowance?.proposalSignature === proposalSignature) return false;
    return this.touchBindRecovery(state, ask, {
      ...record,
      preDispatchRetryAllowance: { proposalSignature, remaining: 1 },
    });
  }

  consumePreDispatchRetryAllowance(
    sessionId: string | undefined,
    ask: string,
    proposalSignature: string,
  ): boolean {
    const state = this.get(sessionId);
    const record = state?.bindRecoveryByAsk.get(ask);
    const allowance = record?.preDispatchRetryAllowance;
    if (
      !state ||
      !record ||
      allowance?.proposalSignature !== proposalSignature ||
      allowance.remaining !== 1
    ) {
      return false;
    }
    return this.touchBindRecovery(state, ask, {
      ...record,
      preDispatchRetryAllowance: { proposalSignature, remaining: 0 },
    });
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
