// src/desktop/route/route-gate.test.ts
//
// The one-shot deflection gate. Fires ONLY when ROUTE_ENFORCEMENT is on, ONLY for an ask that
// classifies to bind-first or a supported refine-op shape, ONLY once per (session, ask) — the
// second call executes and records a route_override. Everything else is a no-op (fail-open).
//
// FLAG-OFF INERTNESS (constraint 3) is pinned explicitly: with the flag unset, checkRouteGate
// is a total no-op — it returns null, classifies nothing that matters, and records nothing —
// so tool behavior is byte-identical to the gate's absence. (tools/list byte-identity is pinned
// separately by server.desktop.test.ts's serialized-surface test, which this slice leaves at
// its exact prior total.)

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { loadManifests } from '../binder/manifest.js';
import type { TemplateManifest } from '../binder/manifest-types.js';
import {
  BIND_TEMPLATE_TOOL,
  checkRouteGate,
  decideRouteGate,
  deflectionText,
  REFINE_WORKSHEET_TOOL,
  refineDeflectionText,
  routeEnforcementEnabled,
} from './route-gate.js';
import { sessionRouteState } from './route-state.js';

const FLAG = 'ROUTE_ENFORCEMENT';
const ORIGINAL = process.env[FLAG];

function enable(): void {
  process.env[FLAG] = 'on';
}
function disable(): void {
  delete process.env[FLAG];
}

/** Parse the trailing structured marker content item (the next_route JSON blob). */
function marker(result: { content: { type: 'text'; text: string }[] }): Record<string, unknown> {
  const last = result.content[result.content.length - 1];
  return JSON.parse(last.text) as Record<string, unknown>;
}

let manifests: TemplateManifest[];
beforeAll(() => {
  manifests = [...loadManifests().values()];
});

beforeEach(() => {
  sessionRouteState.clear();
  disable();
});
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env[FLAG];
  else process.env[FLAG] = ORIGINAL;
});

describe('routeEnforcementEnabled (ROUTE_ENFORCEMENT, default OFF)', () => {
  it('is off when the flag is unset', () => {
    disable();
    expect(routeEnforcementEnabled()).toBe(false);
  });
  it('is off when the flag is any value other than on', () => {
    process.env[FLAG] = 'off';
    expect(routeEnforcementEnabled()).toBe(false);
    process.env[FLAG] = '0';
    expect(routeEnforcementEnabled()).toBe(false);
  });
  it("is on only when the flag is 'on' (case-insensitive)", () => {
    process.env[FLAG] = 'on';
    expect(routeEnforcementEnabled()).toBe(true);
    process.env[FLAG] = 'ON';
    expect(routeEnforcementEnabled()).toBe(true);
  });
});

describe('decideRouteGate (pure decision, flag-independent)', () => {
  it('no-ops when the route is not bind-first or refine-op', () => {
    expect(decideRouteGate({ route: 'free', shape: 'unmatched', alreadyDeflected: false })).toBe(
      'noop',
    );
    expect(
      decideRouteGate({ route: 'scratch-pipeline', shape: 'hazard-set', alreadyDeflected: false }),
    ).toBe('noop');
  });
  it('no-ops for a refine-op route whose shape has no supported fast lane', () => {
    expect(
      decideRouteGate({ route: 'refine-op', shape: 'refine-encoding', alreadyDeflected: false }),
    ).toBe('noop');
  });
  it('deflects a bind-first ask that has not been deflected yet', () => {
    expect(
      decideRouteGate({
        route: 'bind-first',
        shape: 'bind-first-template',
        alreadyDeflected: false,
      }),
    ).toBe('deflect');
  });
  it('deflects a supported refine-op shape (top-N / sort) not yet deflected', () => {
    expect(
      decideRouteGate({ route: 'refine-op', shape: 'refine-top-n', alreadyDeflected: false }),
    ).toBe('deflect');
    expect(
      decideRouteGate({ route: 'refine-op', shape: 'refine-sort', alreadyDeflected: false }),
    ).toBe('deflect');
  });
  it('overrides (executes) once this (session, ask) was already deflected', () => {
    expect(
      decideRouteGate({
        route: 'bind-first',
        shape: 'bind-first-template',
        alreadyDeflected: true,
      }),
    ).toBe('override');
  });
});

describe('deflection text names the tmcp fast-lane tool on a single actionable line', () => {
  it('bind-first wording names bind-template', () => {
    expect(deflectionText('ranking-ordered-bar')).toBe(
      "Route: bind-first. Template 'ranking-ordered-bar' matches this ask — call bind-template first; if it escalates or proposes, retry this call and it will proceed.",
    );
    expect(deflectionText('x').includes('\n')).toBe(false);
    expect(BIND_TEMPLATE_TOOL).toBe('bind-template');
  });
  it('refine-op wording names refine-worksheet', () => {
    expect(refineDeflectionText()).toBe(
      'Route: refine-op. This is a supported worksheet refinement — call refine-worksheet first; if it refuses, retry this call and it will proceed.',
    );
    expect(refineDeflectionText().includes('\n')).toBe(false);
    expect(REFINE_WORKSHEET_TOOL).toBe('refine-worksheet');
  });
});

describe('checkRouteGate — flag OFF is a total no-op (inertness)', () => {
  it('returns null and records nothing even for a deflectable ask', () => {
    disable();
    const r = checkRouteGate({
      toolName: 'batch-create-and-cache-sheets',
      sessionId: 'S1',
      ask: 'bar chart of Sales by Region',
      manifests,
    });
    expect(r).toBeNull();
    expect(sessionRouteState.get('S1')).toBeUndefined();
  });
});

describe('checkRouteGate — one-shot deflection then override (flag ON, real manifests)', () => {
  beforeEach(enable);

  it('first scratch-entry call for a bind-first ask is deflected (text + marker + recorded)', () => {
    const r = checkRouteGate({
      toolName: 'build-and-apply-worksheet',
      sessionId: 'S1',
      ask: 'bar chart of Sales by Region',
      manifests,
    });
    expect(r).not.toBeNull();
    expect(r!.isError).toBe(false);
    expect(r!.content[0].text).toBe(deflectionText('ranking-ordered-bar'));
    expect(marker(r!).next_route).toBe('bind-first');
    expect(marker(r!).template).toBe('ranking-ordered-bar');

    const s = sessionRouteState.get('S1')!;
    expect(s.deflections).toHaveLength(1);
    expect(s.deflections[0].tool).toBe('build-and-apply-worksheet');
    expect(s.deflections[0].template).toBe('ranking-ordered-bar');
    expect(s.deflections[0].next_route).toBe('bind-first');
    expect(typeof s.deflections[0].ts).toBe('string');
    expect(s.route_overrides).toEqual([]);
  });

  it('second call for the same (session, ask) executes (null) and records ONE route_override', () => {
    const args = {
      toolName: 'build-and-apply-worksheet',
      sessionId: 'S1',
      ask: 'bar chart of Sales by Region',
      manifests,
    };
    checkRouteGate(args);
    const second = checkRouteGate(args);
    expect(second).toBeNull();
    const s = sessionRouteState.get('S1')!;
    expect(s.deflections).toHaveLength(1);
    expect(s.route_overrides).toHaveLength(1);
    expect(s.route_overrides[0].tool).toBe('build-and-apply-worksheet');
    expect(s.route_overrides[0].template).toBe('ranking-ordered-bar');
  });

  it('never loops: 3 consecutive calls → 1 deflection, 2 executions, 1 override', () => {
    const args = {
      toolName: 'batch-create-and-cache-sheets',
      sessionId: 'S1',
      ask: 'bar chart of Sales by Region',
      manifests,
    };
    const results = [1, 2, 3].map(() => checkRouteGate(args));
    expect(results.filter((r) => r !== null)).toHaveLength(1);
    expect(results.filter((r) => r === null)).toHaveLength(2);
    const s = sessionRouteState.get('S1')!;
    expect(s.deflections).toHaveLength(1);
    expect(s.route_overrides).toHaveLength(1);
  });

  it('first refine-op ask is deflected with the refine tool marker and classified shape', () => {
    const r = checkRouteGate({
      toolName: 'build-and-apply-worksheet',
      sessionId: 'S1',
      ask: 'just the top five sub-categories',
      manifests,
    });
    expect(r).not.toBeNull();
    expect(r!.content[0].text).toBe(refineDeflectionText());
    expect(marker(r!)).toEqual({
      next_route: 'refine-op',
      tool: 'refine-worksheet',
      shape: 'refine-top-n',
    });
    const s = sessionRouteState.get('S1')!;
    expect(s.deflections).toHaveLength(1);
    expect(s.deflections[0]).toMatchObject({
      tool: 'build-and-apply-worksheet',
      next_route: 'refine-op',
      shape: 'refine-top-n',
      text: refineDeflectionText(),
    });
  });

  it('second refine-op call executes and records a route_override', () => {
    const args = {
      toolName: 'build-and-apply-worksheet',
      sessionId: 'S1',
      ask: 'just the top five sub-categories',
      manifests,
    };
    checkRouteGate(args);
    const second = checkRouteGate(args);
    expect(second).toBeNull();
    const s = sessionRouteState.get('S1')!;
    expect(s.deflections).toHaveLength(1);
    expect(s.route_overrides).toHaveLength(1);
    expect(s.route_overrides[0]).toMatchObject({
      tool: 'build-and-apply-worksheet',
      shape: 'refine-top-n',
    });
  });

  it('one-shot is per (session, ask): a DIFFERENT ask in the same session deflects again', () => {
    checkRouteGate({
      toolName: 'build-and-apply-worksheet',
      sessionId: 'S1',
      ask: 'bar chart of Sales by Region',
      manifests,
    });
    const other = checkRouteGate({
      toolName: 'build-and-apply-worksheet',
      sessionId: 'S1',
      ask: 'just the top five sub-categories',
      manifests,
    });
    expect(other).not.toBeNull();
    expect(sessionRouteState.get('S1')!.deflections).toHaveLength(2);
  });
});

describe('checkRouteGate — no-op cases (fail-open, flag ON)', () => {
  beforeEach(enable);

  it('a free / non-routed ask is never deflected', () => {
    const r = checkRouteGate({
      toolName: 'build-and-apply-worksheet',
      sessionId: 'S1',
      ask: 'asdf qwerty zxcv plok',
      manifests,
    });
    expect(r).toBeNull();
    expect(sessionRouteState.get('S1')).toBeUndefined();
  });

  it('a hazard (scratch-pipeline) ask is never deflected', () => {
    const r = checkRouteGate({
      toolName: 'build-and-apply-worksheet',
      sessionId: 'S1',
      ask: 'create a set of my top customers',
      manifests,
    });
    expect(r).toBeNull();
    expect(sessionRouteState.get('S1')).toBeUndefined();
  });

  it('a call with no session id is never deflected', () => {
    expect(
      checkRouteGate({
        toolName: 'build-and-apply-worksheet',
        sessionId: undefined,
        ask: 'bar chart of Sales by Region',
        manifests,
      }),
    ).toBeNull();
  });

  it('an empty ask is never deflected', () => {
    const r = checkRouteGate({
      toolName: 'build-and-apply-worksheet',
      sessionId: 'S1',
      ask: '   ',
      manifests,
    });
    expect(r).toBeNull();
    expect(sessionRouteState.get('S1')).toBeUndefined();
  });
});
