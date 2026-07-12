// src/desktop/route/route-state.test.ts
//
// Session-keyed route state. Deflections/overrides are recorded per resolved Desktop session
// id and lazy-inited on first write (no begin-episode init exists). No-session paths no-op
// (fail-open). The one-shot dedup key is (session, normalized-ask).

import { beforeEach, describe, expect, it } from 'vitest';

import { type RouteDeflection, sessionRouteState, SessionRouteStateStore } from './route-state.js';

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
});
