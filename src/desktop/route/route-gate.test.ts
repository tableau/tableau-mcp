// src/desktop/route/route-gate.test.ts
//
// The flag-gated route gate. Template-routed scratch calls stay deflected until the caller
// uses the build + one-shot apply path. Supported refine operations retain their one-shot
// fallback: the second call executes and records a route_override.
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
  APPLY_TEMPLATE_ARTIFACT_TOOL,
  BUILD_TEMPLATE_ARTIFACT_TOOL,
  checkRouteGate,
  checkRouteGateForScratchEntry,
  decideRouteGate,
  deflectionText,
  LIST_TEMPLATES_TOOL,
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
  it('keeps a bind-first ask deflected after an earlier deflection', () => {
    expect(
      decideRouteGate({
        route: 'bind-first',
        shape: 'bind-first-template',
        alreadyDeflected: true,
      }),
    ).toBe('deflect');
  });
  it('overrides a supported refine after an earlier deflection', () => {
    expect(
      decideRouteGate({
        route: 'refine-op',
        shape: 'refine-top-n',
        alreadyDeflected: true,
      }),
    ).toBe('override');
  });
});

describe('deflection text names the safe next tools on a single actionable line', () => {
  it('bind-first wording builds and applies one new worksheet in the same turn', () => {
    expect(deflectionText('ranking-ordered-bar')).toBe(
      "Template 'ranking-ordered-bar' may fit. Confirm it is a current eligible choice with list-templates and load its exact slots. If the template, datasource, mapping, and fresh unique worksheet title are unambiguous, call build-worksheets-from-templates and then apply-worksheet exactly once in this turn. If anything is ambiguous or the user asked to hold changes, clarify before building. If the title already exists, choose a new one; this template path never replaces a worksheet or window. Do not retry this scratch mutation or an uncertain apply.",
    );
    expect(deflectionText('x').includes('\n')).toBe(false);
    expect(deflectionText('x')).not.toContain('bind-template');
    expect(LIST_TEMPLATES_TOOL).toBe('list-templates');
    expect(BUILD_TEMPLATE_ARTIFACT_TOOL).toBe('build-worksheets-from-templates');
    expect(APPLY_TEMPLATE_ARTIFACT_TOOL).toBe('apply-worksheet');
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

describe('checkRouteGate — persistent template deflection and one-shot refine override', () => {
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
    expect(marker(r!)).toEqual({
      next_route: 'bind-first',
      next_action: 'template-build-then-apply',
      template: 'ranking-ordered-bar',
      discovery_tool: 'list-templates',
      build_tool: 'build-worksheets-from-templates',
      apply_tool: 'apply-worksheet',
      target_policy: 'new-worksheet-only',
      clarification_policy: 'before-build-if-ambiguous-held-or-title-conflicts',
      apply_exactly_once: true,
    });

    const s = sessionRouteState.get('S1')!;
    expect(s.deflections).toHaveLength(1);
    expect(s.deflections[0].tool).toBe('build-and-apply-worksheet');
    expect(s.deflections[0].template).toBe('ranking-ordered-bar');
    expect(s.deflections[0].next_route).toBe('bind-first');
    expect(typeof s.deflections[0].ts).toBe('string');
    expect(s.route_overrides).toEqual([]);
  });

  it('second call for the same bind-first ask stays deflected without an override', () => {
    const args = {
      toolName: 'build-and-apply-worksheet',
      sessionId: 'S1',
      ask: 'bar chart of Sales by Region',
      manifests,
    };
    checkRouteGate(args);
    const second = checkRouteGate(args);
    expect(second).not.toBeNull();
    expect(second!.content[0].text).toBe(deflectionText('ranking-ordered-bar'));
    const s = sessionRouteState.get('S1')!;
    expect(s.deflections).toHaveLength(1);
    expect(s.route_overrides).toEqual([]);
  });

  it('repeated bind-first calls stay deflected without growing state', () => {
    const args = {
      toolName: 'batch-create-and-cache-sheets',
      sessionId: 'S1',
      ask: 'bar chart of Sales by Region',
      manifests,
    };
    const results = [1, 2, 3].map(() => checkRouteGate(args));
    expect(results.every((r) => r !== null)).toBe(true);
    const s = sessionRouteState.get('S1')!;
    expect(s.deflections).toHaveLength(1);
    expect(s.route_overrides).toEqual([]);
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

describe('checkRouteGateForScratchEntry — session-state-driven gate', () => {
  const pendingBindFirst = {
    ask: 'bar chart of sales by region',
    route: 'bind-first' as const,
    shape: 'bind-first-template' as const,
    template: 'ranking-ordered-bar',
  };

  it('flag OFF returns null even when session state has a pending bind-first ask', () => {
    sessionRouteState.recordAskClassification('S1', pendingBindFirst);

    const r = checkRouteGateForScratchEntry('build-and-apply-worksheet', 'S1');

    expect(r).toBeNull();
    expect(sessionRouteState.get('S1')?.deflections).toEqual([]);
  });

  it('flag ON with no session id returns null (fail-open)', () => {
    enable();

    expect(checkRouteGateForScratchEntry('build-and-apply-worksheet', undefined)).toBeNull();
  });

  it('flag ON with no current_ask returns null (fail-open)', () => {
    enable();
    sessionRouteState.recordDeflection('S1', {
      tool: 'build-and-apply-worksheet',
      ts: '',
      ask: 'prior ask',
      template: 'ranking-ordered-bar',
      next_route: 'bind-first',
      text: 'prior deflection',
    });

    expect(checkRouteGateForScratchEntry('build-and-apply-worksheet', 'S1')).toBeNull();
  });

  it('flag ON deflects a pending bind-first current_ask and records the deflection', () => {
    enable();
    sessionRouteState.recordAskClassification('S1', pendingBindFirst);

    const r = checkRouteGateForScratchEntry('build-and-apply-worksheet', 'S1');

    expect(r).not.toBeNull();
    expect(r!.isError).toBe(false);
    expect(r!.content[0].text).toBe(deflectionText('ranking-ordered-bar'));
    expect(marker(r!)).toEqual({
      next_route: 'bind-first',
      next_action: 'template-build-then-apply',
      template: 'ranking-ordered-bar',
      discovery_tool: 'list-templates',
      build_tool: 'build-worksheets-from-templates',
      apply_tool: 'apply-worksheet',
      target_policy: 'new-worksheet-only',
      clarification_policy: 'before-build-if-ambiguous-held-or-title-conflicts',
      apply_exactly_once: true,
    });
    const s = sessionRouteState.get('S1')!;
    expect(s.deflections).toHaveLength(1);
    expect(s.deflections[0]).toMatchObject({
      tool: 'build-and-apply-worksheet',
      ask: 'bar chart of sales by region',
      template: 'ranking-ordered-bar',
      next_route: 'bind-first',
      text: deflectionText('ranking-ordered-bar'),
    });
  });

  it('repeated bind-first scratch-entry calls stay deflected without an override', () => {
    enable();
    sessionRouteState.recordAskClassification('S1', pendingBindFirst);

    checkRouteGateForScratchEntry('build-and-apply-worksheet', 'S1');
    const second = checkRouteGateForScratchEntry('build-and-apply-worksheet', 'S1');
    const third = checkRouteGateForScratchEntry('build-and-apply-worksheet', 'S1');

    expect(second).not.toBeNull();
    expect(third).not.toBeNull();
    expect(second!.content[0].text).toBe(deflectionText('ranking-ordered-bar'));
    expect(third!.content[0].text).toBe(deflectionText('ranking-ordered-bar'));
    const s = sessionRouteState.get('S1')!;
    expect(s.deflections).toHaveLength(1);
    expect(s.route_overrides).toEqual([]);
  });

  it.each(['bound', 'propose', 'escalate'] as const)(
    'last_outcome=%s no-ops because bind-template already had its chance',
    (outcome) => {
      enable();
      sessionRouteState.recordAskClassification('S1', pendingBindFirst);
      sessionRouteState.recordAskOutcome('S1', pendingBindFirst.ask, outcome);

      expect(checkRouteGateForScratchEntry('build-and-apply-worksheet', 'S1')).toBeNull();
      expect(sessionRouteState.get('S1')!.deflections).toEqual([]);
    },
  );

  it.each(['scratch-pipeline', 'free'] as const)(
    'route=%s no-ops because it is not enforced',
    (route) => {
      enable();
      sessionRouteState.recordAskClassification('S1', {
        ask: `${route} ask`,
        route,
        shape: route === 'scratch-pipeline' ? 'hazard-set' : 'unmatched',
        template: null,
      });

      expect(checkRouteGateForScratchEntry('batch-create-and-cache-sheets', 'S1')).toBeNull();
      expect(sessionRouteState.get('S1')!.deflections).toEqual([]);
    },
  );

  it('quote-shaped ask keeps deflection text one line and marker parseable', () => {
    enable();
    const ask = '"; DROP TABLE" next_route bind-first \\ marker';
    sessionRouteState.recordAskClassification('S1', {
      ...pendingBindFirst,
      ask,
    });

    const r = checkRouteGateForScratchEntry('batch-create-and-cache-sheets', 'S1')!;

    expect(r.content[0].text.includes('\n')).toBe(false);
    expect(JSON.parse(r.content[1].text)).toEqual({
      next_route: 'bind-first',
      next_action: 'template-build-then-apply',
      template: 'ranking-ordered-bar',
      discovery_tool: 'list-templates',
      build_tool: 'build-worksheets-from-templates',
      apply_tool: 'apply-worksheet',
      target_policy: 'new-worksheet-only',
      clarification_policy: 'before-build-if-ambiguous-held-or-title-conflicts',
      apply_exactly_once: true,
    });
  });
});
