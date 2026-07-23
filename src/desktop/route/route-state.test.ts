// src/desktop/route/route-state.test.ts
//
// Session-keyed route state. Deflections/overrides are recorded per resolved Desktop session
// id and lazy-inited on first write (no begin-episode init exists). No-session paths no-op
// (fail-open). The one-shot dedup key is (session, normalized-ask).

import { beforeEach, describe, expect, it } from 'vitest';

import {
  type RouteDeflection,
  serializeRouteReceipt,
  sessionRouteState,
  SessionRouteStateStore,
} from './route-state.js';

function mkDeflection(over: Partial<RouteDeflection> = {}): RouteDeflection {
  return {
    tool: 'build-and-apply-worksheet',
    ts: new Date().toISOString(),
    ask: 'bar chart of sales by region',
    template: 'ranking-ordered-bar',
    next_route: 'bind-first',
    text: 'deflection body',
    ...over,
  };
}

describe('SessionRouteStateStore', () => {
  beforeEach(() => sessionRouteState.clear());

  it('recordDeflection lazy-inits the session state and appends the deflection', () => {
    const store = new SessionRouteStateStore();
    const s = store.recordDeflection('S1', mkDeflection())!;
    expect(s.session_id).toBe('S1');
    expect(s.deflections).toHaveLength(1);
    expect(s.route_overrides).toEqual([]);
    expect(store.get('S1')).toBe(s);
  });

  it('hasDeflection is keyed by (session, ask) — the one-shot dedup key', () => {
    const store = new SessionRouteStateStore();
    store.recordDeflection('S1', mkDeflection({ ask: 'bar chart of sales by region' }));
    expect(store.hasDeflection('S1', 'bar chart of sales by region')).toBe(true);
    // A different ask in the same session is a distinct one-shot.
    expect(store.hasDeflection('S1', 'line chart over time')).toBe(false);
    // A different session with the same ask is a distinct one-shot.
    expect(store.hasDeflection('S2', 'bar chart of sales by region')).toBe(false);
  });

  it('recordOverride appends and hasOverride tracks it per (session, ask)', () => {
    const store = new SessionRouteStateStore();
    store.recordOverride('S1', {
      tool: 'build-and-apply-worksheet',
      ts: new Date().toISOString(),
      ask: 'bar chart of sales by region',
      template: 'ranking-ordered-bar',
    });
    expect(store.get('S1')!.route_overrides).toHaveLength(1);
    expect(store.hasOverride('S1', 'bar chart of sales by region')).toBe(true);
    expect(store.hasOverride('S1', 'other ask')).toBe(false);
  });

  it('get / hasDeflection no-op for an unknown or absent session id', () => {
    const store = new SessionRouteStateStore();
    expect(store.get('nope')).toBeUndefined();
    expect(store.get(undefined)).toBeUndefined();
    expect(store.hasDeflection(undefined, 'x')).toBe(false);
    expect(store.hasDeflection('nope', 'x')).toBe(false);
  });

  it('recordDeflection / recordOverride no-op (undefined) without a session id (fail-open)', () => {
    const store = new SessionRouteStateStore();
    expect(store.recordDeflection(undefined, mkDeflection())).toBeUndefined();
    expect(
      store.recordOverride(undefined, {
        tool: 'x',
        ts: '',
        ask: 'a',
      }),
    ).toBeUndefined();
  });

  it('evict removes a session state; reading it before evict still sees it', () => {
    const store = new SessionRouteStateStore();
    store.recordDeflection('S1', mkDeflection());
    expect(store.get('S1')?.deflections).toHaveLength(1);
    expect(store.evict('S1')).toBe(true);
    expect(store.get('S1')).toBeUndefined();
  });

  it('evict is a no-op (false) for an unknown or absent session id (fail-open)', () => {
    const store = new SessionRouteStateStore();
    expect(store.evict('nope')).toBe(false);
    expect(store.evict(undefined)).toBe(false);
  });

  it('exposes a shared module singleton that clear() resets', () => {
    sessionRouteState.recordDeflection('S-a', mkDeflection());
    expect(sessionRouteState.get('S-a')?.deflections).toHaveLength(1);
    sessionRouteState.clear();
    expect(sessionRouteState.get('S-a')).toBeUndefined();
  });

  it('safety cap: retains only the newest MAX_STATES; the oldest evict first', () => {
    const store = new SessionRouteStateStore();
    const cap = SessionRouteStateStore.MAX_STATES;
    for (let i = 0; i < cap + 5; i++) store.recordDeflection(`S-${i}`, mkDeflection());
    expect(store.get('S-0')).toBeUndefined();
    expect(store.get('S-4')).toBeUndefined();
    expect(store.get('S-5')?.deflections).toHaveLength(1);
    expect(store.get(`S-${cap + 4}`)?.deflections).toHaveLength(1);
  });

  it('per-session cap: each record array FIFO-evicts past MAX_ENTRIES_PER_SESSION', () => {
    const store = new SessionRouteStateStore();
    const cap = SessionRouteStateStore.MAX_ENTRIES_PER_SESSION;
    for (let i = 0; i < cap + 3; i++) {
      store.recordDeflection('S1', mkDeflection({ ask: `ask-${i}` }));
      store.recordOverride('S1', { tool: 'x', ts: '', ask: `ask-${i}` });
    }
    const s = store.get('S1')!;
    expect(s.deflections).toHaveLength(cap);
    expect(s.route_overrides).toHaveLength(cap);
    // Oldest evicted, newest retained — the one-shot invariant weakens to
    // at-most-twice only for evicted asks.
    expect(store.hasDeflection('S1', 'ask-0')).toBe(false);
    expect(store.hasDeflection('S1', `ask-${cap + 2}`)).toBe(true);
  });

  describe('summary-data transient failure state', () => {
    it('counts transient failures by session and signature without storing payloads', () => {
      const store = new SessionRouteStateStore();

      expect(store.recordSummaryDataTransientFailure('S1', 'signature-a')).toBe(1);
      expect(store.recordSummaryDataTransientFailure('S1', 'signature-a')).toBe(2);
      expect(store.recordSummaryDataTransientFailure('S1', 'signature-b')).toBe(1);
      expect(store.recordSummaryDataTransientFailure('S2', 'signature-a')).toBe(1);
      expect(store.recordSummaryDataTransientFailure(undefined, 'signature-a')).toBe(1);

      expect(store.get('S1')?.summaryDataTransientFailures.get('signature-a')).toBe(2);
      expect(store.get('S1')?.summaryDataTransientFailures.get('signature-b')).toBe(1);
      expect(store.get('S2')?.summaryDataTransientFailures.get('signature-a')).toBe(1);
    });

    it('clears a signature after a success or genuine no-data outcome', () => {
      const store = new SessionRouteStateStore();

      store.recordSummaryDataTransientFailure('S1', 'signature-a');
      store.recordSummaryDataTransientFailure('S1', 'signature-a');
      expect(store.clearSummaryDataTransientFailure('S1', 'signature-a')).toBe(true);
      expect(store.get('S1')?.summaryDataTransientFailures.has('signature-a')).toBe(false);
      expect(store.clearSummaryDataTransientFailure('S1', 'signature-a')).toBe(false);
      expect(store.clearSummaryDataTransientFailure(undefined, 'signature-a')).toBe(false);
    });

    it('keeps transient signatures LRU-bounded', () => {
      const store = new SessionRouteStateStore();
      const cap = SessionRouteStateStore.MAX_SUMMARY_DATA_FAILURE_SIGNATURES;

      for (let i = 0; i < cap + 1; i++) {
        store.recordSummaryDataTransientFailure('S1', `signature-${i}`);
      }

      expect(store.get('S1')?.summaryDataTransientFailures.size).toBe(cap);
      expect(store.get('S1')?.summaryDataTransientFailures.has('signature-0')).toBe(false);
      expect(store.get('S1')?.summaryDataTransientFailures.has(`signature-${cap}`)).toBe(true);
    });
  });

  describe('current ask classification state', () => {
    it('recordAskClassification lazy-inits state and sets current_ask with a pending outcome', () => {
      const store = new SessionRouteStateStore();

      const s = store.recordAskClassification('S1', {
        ask: 'bar chart of sales by region',
        route: 'bind-first',
        shape: 'bind-first-template',
        template: 'ranking-ordered-bar',
      })!;

      expect(s.session_id).toBe('S1');
      expect(s.deflections).toEqual([]);
      expect(s.route_overrides).toEqual([]);
      expect(s.current_ask).toMatchObject({
        ask: 'bar chart of sales by region',
        route: 'bind-first',
        shape: 'bind-first-template',
        template: 'ranking-ordered-bar',
        last_outcome: null,
      });
      expect(typeof s.current_ask!.ts).toBe('string');
      expect(store.get('S1')).toBe(s);
    });

    it('recordAskClassification overwrites the prior current_ask (most-recent-ask-wins)', () => {
      const store = new SessionRouteStateStore();
      store.recordAskClassification('S1', {
        ask: 'bar chart of sales by region',
        route: 'bind-first',
        shape: 'bind-first-template',
        template: 'ranking-ordered-bar',
      });

      store.recordAskClassification('S1', {
        ask: 'line chart of profit over time',
        route: 'free',
        shape: 'unmatched',
        template: null,
      });

      expect(store.get('S1')!.current_ask).toMatchObject({
        ask: 'line chart of profit over time',
        route: 'free',
        shape: 'unmatched',
        template: null,
        last_outcome: null,
      });
    });

    it('recordAskOutcome fills last_outcome when the ask key matches current_ask.ask', () => {
      const store = new SessionRouteStateStore();
      store.recordAskClassification('S1', {
        ask: 'bar chart of sales by region',
        route: 'bind-first',
        shape: 'bind-first-template',
        template: 'ranking-ordered-bar',
      });

      const s = store.recordAskOutcome('S1', 'bar chart of sales by region', 'bound')!;

      expect(s.current_ask?.last_outcome).toBe('bound');
    });

    it('recordAskOutcome no-ops when current_ask is absent', () => {
      const store = new SessionRouteStateStore();

      expect(store.recordAskOutcome('S1', 'bar chart of sales by region', 'bound')).toBeUndefined();
      expect(store.get('S1')).toBeUndefined();
    });

    it('recordAskOutcome no-ops when a later ask overwrote current_ask before outcome landed', () => {
      const store = new SessionRouteStateStore();
      store.recordAskClassification('S1', {
        ask: 'first ask',
        route: 'bind-first',
        shape: 'bind-first-template',
        template: 'ranking-ordered-bar',
      });
      store.recordAskClassification('S1', {
        ask: 'second ask',
        route: 'free',
        shape: 'unmatched',
        template: null,
      });

      expect(store.recordAskOutcome('S1', 'first ask', 'bound')).toBeUndefined();
      expect(store.get('S1')!.current_ask).toMatchObject({
        ask: 'second ask',
        last_outcome: null,
      });
    });

    it('recordAskClassification / recordAskOutcome no-op without a session id (fail-open)', () => {
      const store = new SessionRouteStateStore();

      expect(
        store.recordAskClassification(undefined, {
          ask: 'bar chart of sales by region',
          route: 'bind-first',
          shape: 'bind-first-template',
          template: 'ranking-ordered-bar',
        }),
      ).toBeUndefined();
      expect(
        store.recordAskOutcome(undefined, 'bar chart of sales by region', 'bound'),
      ).toBeUndefined();
    });

    it('clearCurrentAsk drops a matching pending ask and fail-opens on everything else', () => {
      const store = new SessionRouteStateStore();
      const classify = (ask: string): void => {
        store.recordAskClassification('S1', {
          ask,
          route: 'bind-first',
          shape: 'bind-first-template',
          template: 'ranking-ordered-bar',
        });
      };

      // ask-scoped clear: only the matching ask is dropped.
      classify('ask A');
      expect(store.clearCurrentAsk('S1', 'ask B')).toBe(false);
      expect(store.get('S1')!.current_ask).toMatchObject({ ask: 'ask A' });
      expect(store.clearCurrentAsk('S1', 'ask A')).toBe(true);
      expect(store.get('S1')!.current_ask).toBeUndefined();

      // unconditional clear: whatever is pending goes.
      classify('ask C');
      expect(store.clearCurrentAsk('S1')).toBe(true);
      expect(store.get('S1')!.current_ask).toBeUndefined();

      // fail-open: absent slot, unknown/missing session.
      expect(store.clearCurrentAsk('S1')).toBe(false);
      expect(store.clearCurrentAsk('NOPE')).toBe(false);
      expect(store.clearCurrentAsk(undefined)).toBe(false);
    });
  });

  describe('bind recovery state', () => {
    it('records Call 1 propose then first proposal Call 2 without consuming retry budget', () => {
      const store = new SessionRouteStateStore();

      store.recordBindRecoveryAttempt('S1', 'ask A', { outcome: 'propose' });
      store.recordBindRecoveryAttempt('S1', 'ask A', {
        outcome: 'escalate',
        proposalSignature: 'signature-1',
      });

      const record = store.getBindRecovery('S1', 'ask A')!;
      expect(record.phase).toBe('proposal-attempted');
      expect(record.lastProposalSignature).toBe('signature-1');
      expect(record.attempts).toHaveLength(2);
      expect(record.attempts.map((a) => a.outcome)).toEqual(['propose', 'escalate']);
      expect(record.attempts.map((a) => a.consumesRetryBudget)).toEqual([false, false]);
      expect(typeof record.attempts[0].ts).toBe('string');
    });

    it('marks a semantically changed proposal after Call 2 as the single consumed retry', () => {
      const store = new SessionRouteStateStore();

      store.recordBindRecoveryAttempt('S1', 'ask A', { outcome: 'propose' });
      store.recordBindRecoveryAttempt('S1', 'ask A', {
        outcome: 'escalate',
        proposalSignature: 'signature-1',
      });
      store.recordBindRecoveryAttempt('S1', 'ask A', {
        outcome: 'escalate',
        proposalSignature: 'signature-2',
      });

      const record = store.getBindRecovery('S1', 'ask A')!;
      expect(record.phase).toBe('retry-used');
      expect(record.lastProposalSignature).toBe('signature-2');
      expect(record.attempts.map((a) => a.consumesRetryBudget)).toEqual([false, false, true]);
    });

    it('stores and consumes one pre-dispatch retry allowance for the last proposal signature', () => {
      const store = new SessionRouteStateStore();
      store.recordBindRecoveryAttempt('S1', 'ask A', { outcome: 'propose' });
      store.recordBindRecoveryAttempt('S1', 'ask A', {
        outcome: 'bound',
        proposalSignature: 'signature-1',
      });

      expect(store.grantPreDispatchRetryAllowance('S1', 'ask A', 'different-signature')).toBe(
        false,
      );
      expect(store.grantPreDispatchRetryAllowance('S1', 'ask A', 'signature-1')).toBe(true);
      expect(store.consumePreDispatchRetryAllowance('S1', 'ask A', 'signature-1')).toBe(true);
      expect(store.consumePreDispatchRetryAllowance('S1', 'ask A', 'signature-1')).toBe(false);
      expect(store.grantPreDispatchRetryAllowance('S1', 'ask A', 'signature-1')).toBe(false);
      expect(store.getBindRecovery('S1', 'ask A')?.preDispatchRetryAllowance).toEqual({
        proposalSignature: 'signature-1',
        remaining: 0,
      });
    });

    it('drops a stale pre-dispatch allowance when the proposal signature changes', () => {
      const store = new SessionRouteStateStore();
      store.recordBindRecoveryAttempt('S1', 'ask A', {
        outcome: 'bound',
        proposalSignature: 'signature-1',
      });
      store.grantPreDispatchRetryAllowance('S1', 'ask A', 'signature-1');

      store.reserveBindRecoveryAdmission('S1', 'ask A', {
        proposalSignature: 'signature-2',
      });

      expect(store.getBindRecovery('S1', 'ask A')?.preDispatchRetryAllowance).toBeUndefined();
    });

    it('clears a recovery entry when the bind reaches terminal done', () => {
      const store = new SessionRouteStateStore();
      store.recordBindRecoveryAttempt('S1', 'ask A', { outcome: 'propose' });

      store.recordBindRecoveryAttempt('S1', 'ask A', { outcome: 'bound', terminal: true });

      expect(store.getBindRecovery('S1', 'ask A')).toBeUndefined();
    });

    it('keeps bind recovery separate from current_ask scratch-gate state', () => {
      const store = new SessionRouteStateStore();
      store.recordAskClassification('S1', {
        ask: 'ask A',
        route: 'bind-first',
        shape: 'bind-first-template',
        template: 'ranking-ordered-bar',
      });

      store.recordBindRecoveryAttempt('S1', 'ask A', { outcome: 'propose' });

      expect(store.get('S1')!.current_ask).toMatchObject({
        ask: 'ask A',
        last_outcome: null,
      });
      expect(store.getBindRecovery('S1', 'ask A')?.phase).toBe('awaiting-proposal');
    });

    it('evicts terminal recovery records before active records', () => {
      const store = new SessionRouteStateStore();
      const cap = SessionRouteStateStore.MAX_BIND_RECOVERY_ASKS;

      for (let i = 0; i < cap; i++) {
        store.recordBindRecoveryAttempt('S1', `ask-${i}`, { outcome: 'propose' });
      }
      store.recordBindRecoveryTerminal('S1', 'ask-1', {
        outcome: 'escalate',
        proposalSignature: 'signature-1',
      });
      store.recordBindRecoveryAttempt('S1', `ask-${cap}`, { outcome: 'propose' });

      const state = store.get('S1')!;
      expect(state.bindRecoveryByAsk.size).toBe(cap);
      expect(store.getBindRecovery('S1', 'ask-0')).toBeDefined();
      expect(store.getBindRecovery('S1', 'ask-1')).toBeUndefined();
      expect(store.getBindRecovery('S1', `ask-${cap}`)).toBeDefined();
    });

    it('refreshes bind recovery recency on read', () => {
      const store = new SessionRouteStateStore();
      const cap = SessionRouteStateStore.MAX_BIND_RECOVERY_ASKS;

      for (let i = 0; i < cap; i++) {
        store.recordBindRecoveryTerminal('S1', `ask-${i}`, {
          outcome: 'escalate',
          proposalSignature: `signature-${i}`,
        });
      }

      expect(store.getBindRecovery('S1', 'ask-0')).toBeDefined();
      store.recordBindRecoveryAttempt('S1', `ask-${cap}`, { outcome: 'propose' });

      expect(store.getBindRecovery('S1', 'ask-0')).toBeDefined();
      expect(store.getBindRecovery('S1', 'ask-1')).toBeUndefined();
      expect(store.getBindRecovery('S1', `ask-${cap}`)).toBeDefined();
    });

    it('refuses to create a ninth active recovery record instead of evicting an active ask', () => {
      const store = new SessionRouteStateStore();
      const cap = SessionRouteStateStore.MAX_BIND_RECOVERY_ASKS;

      for (let i = 0; i < cap; i++) {
        store.recordBindRecoveryAttempt('S1', `ask-${i}`, { outcome: 'propose' });
      }
      store.recordBindRecoveryAttempt('S1', `ask-${cap}`, { outcome: 'propose' });

      expect(store.get('S1')!.bindRecoveryByAsk.size).toBe(cap);
      for (let i = 0; i < cap; i++) {
        expect(store.getBindRecovery('S1', `ask-${i}`)).toBeDefined();
      }
      expect(store.getBindRecovery('S1', `ask-${cap}`)).toBeUndefined();
    });

    it('records capacity-rejected admissions as bounded unprotected pass-through receipts', () => {
      const store = new SessionRouteStateStore();
      const cap = SessionRouteStateStore.MAX_BIND_RECOVERY_ASKS;

      for (let i = 0; i < cap; i++) {
        expect(store.reserveBindRecoveryAdmission('S1', `ask-${i}`, {})).toEqual(
          expect.any(Number),
        );
      }
      for (let i = cap; i < cap + 5; i++) {
        expect(store.reserveBindRecoveryAdmission('S1', `ask-${i}`, {})).toBeUndefined();
      }

      expect(store.get('S1')!.bindRecoveryByAsk.size).toBe(cap);
      expect(serializeRouteReceipt(store.get('S1'))?.unprotected_passthroughs).toEqual({
        count: 5,
        last_asks: [`ask-${cap + 1}`, `ask-${cap + 2}`, `ask-${cap + 3}`, `ask-${cap + 4}`],
      });
    });

    it('omits unprotected pass-through receipts when admission is accepted', () => {
      const store = new SessionRouteStateStore();
      store.recordAskClassification('S1', {
        ask: 'ask A',
        route: 'bind-first',
        shape: 'bind-first-template',
        template: 'ranking-ordered-bar',
      });

      expect(store.reserveBindRecoveryAdmission('S1', 'ask A', {})).toEqual(expect.any(Number));

      expect(serializeRouteReceipt(store.get('S1'))).toEqual({
        route: 'bind-first',
        shape: 'bind-first-template',
        template: 'ranking-ordered-bar',
        bind_attempts: {
          count: 1,
          outcomes: [],
          phase: 'awaiting-proposal',
          retry_budget_consumed: 0,
        },
      });
    });

    it('reserves an admitted in-flight bind and upgrades it when the outcome arrives', () => {
      const store = new SessionRouteStateStore();

      store.recordBindRecoveryAttempt('S1', 'ask A', { outcome: 'propose' });
      const reservationId = store.reserveBindRecoveryAdmission('S1', 'ask A', {
        proposalSignature: 'signature-1',
      });

      expect(typeof reservationId).toBe('number');
      expect(store.getBindRecovery('S1', 'ask A')).toMatchObject({
        phase: 'proposal-attempted',
        lastProposalSignature: 'signature-1',
        attempts: [
          { outcome: 'propose', consumesRetryBudget: false },
          { proposalSignature: 'signature-1', consumesRetryBudget: false },
        ],
      });

      store.recordBindRecoveryAttempt('S1', 'ask A', {
        outcome: 'escalate',
        proposalSignature: 'signature-1',
        reservationId,
      });

      expect(store.getBindRecovery('S1', 'ask A')?.attempts).toMatchObject([
        { outcome: 'propose', consumesRetryBudget: false },
        { outcome: 'escalate', proposalSignature: 'signature-1', consumesRetryBudget: false },
      ]);
    });

    it('upgrades concurrent different-signature reservations by reservation id without phantom pending attempts', () => {
      const store = new SessionRouteStateStore();
      store.recordAskClassification('S1', {
        ask: 'ask A',
        route: 'bind-first',
        shape: 'bind-first-template',
        template: 'ranking-ordered-bar',
      });
      store.recordBindRecoveryAttempt('S1', 'ask A', { outcome: 'propose' });

      const firstReservationId = store.reserveBindRecoveryAdmission('S1', 'ask A', {
        proposalSignature: 'signature-1',
      });
      const secondReservationId = store.reserveBindRecoveryAdmission('S1', 'ask A', {
        proposalSignature: 'signature-2',
      });

      store.recordBindRecoveryAttempt('S1', 'ask A', {
        outcome: 'escalate',
        proposalSignature: 'signature-2',
        reservationId: secondReservationId,
      });
      store.recordBindRecoveryAttempt('S1', 'ask A', {
        outcome: 'escalate',
        proposalSignature: 'signature-1',
        reservationId: firstReservationId,
      });

      const record = store.getBindRecovery('S1', 'ask A')!;
      expect(record.phase).toBe('retry-used');
      expect(record.lastProposalSignature).toBe('signature-2');
      expect(record.attempts).toMatchObject([
        { outcome: 'propose', consumesRetryBudget: false },
        { outcome: 'escalate', proposalSignature: 'signature-1', consumesRetryBudget: false },
        { outcome: 'escalate', proposalSignature: 'signature-2', consumesRetryBudget: true },
      ]);
      expect(record.attempts.map((attempt) => attempt.outcome)).toEqual([
        'propose',
        'escalate',
        'escalate',
      ]);
      expect(record.attempts.some((attempt) => attempt.outcome === undefined)).toBe(false);
      expect(serializeRouteReceipt(store.get('S1'))?.bind_attempts).toEqual({
        count: 3,
        outcomes: ['propose', 'escalate', 'escalate'],
        phase: 'retry-used',
        retry_budget_consumed: 1,
      });
    });

    it('flags uncorrelated reservation outcomes without duplicating an already-upgraded attempt', () => {
      const store = new SessionRouteStateStore();
      store.recordAskClassification('S1', {
        ask: 'ask A',
        route: 'bind-first',
        shape: 'bind-first-template',
        template: 'ranking-ordered-bar',
      });
      store.recordBindRecoveryAttempt('S1', 'ask A', { outcome: 'propose' });
      const reservationId = store.reserveBindRecoveryAdmission('S1', 'ask A', {
        proposalSignature: 'signature-1',
      });

      store.recordBindRecoveryAttempt('S1', 'ask A', {
        outcome: 'escalate',
        proposalSignature: 'signature-1',
        reservationId,
      });
      store.recordBindRecoveryAttempt('S1', 'ask A', {
        outcome: 'escalate',
        proposalSignature: 'signature-1',
        reservationId,
      });

      expect(store.getBindRecovery('S1', 'ask A')?.attempts).toMatchObject([
        { outcome: 'propose' },
        { outcome: 'escalate', proposalSignature: 'signature-1' },
      ]);
      expect(serializeRouteReceipt(store.get('S1'))?.bind_attempts).toEqual({
        count: 2,
        outcomes: ['propose', 'escalate'],
        phase: 'proposal-attempted',
        retry_budget_consumed: 0,
        uncorrelated_outcomes: 1,
      });
    });

    it('treats a late outcome for an evicted reservation as uncorrelated after recreation', () => {
      const store = new SessionRouteStateStore();
      store.recordAskClassification('S1', {
        ask: 'ask A',
        route: 'bind-first',
        shape: 'bind-first-template',
        template: 'ranking-ordered-bar',
      });
      store.recordBindRecoveryAttempt('S1', 'ask A', { outcome: 'propose' });
      const staleReservationId = store.reserveBindRecoveryAdmission('S1', 'ask A', {
        proposalSignature: 'stale-signature',
      });
      store.recordBindRecoveryAttempt('S1', 'ask A', { outcome: 'bound', terminal: true });

      store.recordBindRecoveryAttempt('S1', 'ask A', { outcome: 'propose' });
      const freshReservationId = store.reserveBindRecoveryAdmission('S1', 'ask A', {
        proposalSignature: 'fresh-signature',
      });
      store.recordBindRecoveryAttempt('S1', 'ask A', {
        outcome: 'escalate',
        proposalSignature: 'stale-signature',
        reservationId: staleReservationId,
      });

      expect(freshReservationId).not.toBe(staleReservationId);
      const record = store.getBindRecovery('S1', 'ask A')!;
      expect(record.attempts).toMatchObject([
        { outcome: 'propose' },
        { proposalSignature: 'fresh-signature' },
      ]);
      expect(record.attempts[1].outcome).toBeUndefined();
      expect(serializeRouteReceipt(store.get('S1'))?.bind_attempts).toEqual({
        count: 2,
        outcomes: ['propose'],
        phase: 'proposal-attempted',
        retry_budget_consumed: 0,
        uncorrelated_outcomes: 1,
      });
    });

    it('reports retry budget consumed when a changed retry ends in terminal fallback', () => {
      const store = new SessionRouteStateStore();
      store.recordAskClassification('S1', {
        ask: 'ask A',
        route: 'bind-first',
        shape: 'bind-first-template',
        template: 'ranking-ordered-bar',
      });
      store.recordBindRecoveryAttempt('S1', 'ask A', { outcome: 'propose' });
      store.recordBindRecoveryAttempt('S1', 'ask A', {
        outcome: 'escalate',
        proposalSignature: 'signature-1',
      });
      store.recordBindRecoveryTerminal('S1', 'ask A', {
        outcome: 'escalate',
        proposalSignature: 'signature-2',
      });

      expect(serializeRouteReceipt(store.get('S1'))?.bind_attempts).toEqual({
        count: 3,
        outcomes: ['propose', 'escalate', 'escalate'],
        phase: 'terminal',
        retry_budget_consumed: 1,
      });
    });

    it('serializes recovery attempts for the current ask instead of hard-coding one outcome', () => {
      const store = new SessionRouteStateStore();
      store.recordAskClassification('S1', {
        ask: 'ask A',
        route: 'bind-first',
        shape: 'bind-first-template',
        template: 'ranking-ordered-bar',
      });
      store.recordBindRecoveryAttempt('S1', 'ask A', { outcome: 'propose' });
      store.recordBindRecoveryAttempt('S1', 'ask A', {
        outcome: 'escalate',
        proposalSignature: 'signature-1',
      });

      expect(serializeRouteReceipt(store.get('S1'))?.bind_attempts).toEqual({
        count: 2,
        outcomes: ['propose', 'escalate'],
        phase: 'proposal-attempted',
        retry_budget_consumed: 0,
      });
    });
  });
});
