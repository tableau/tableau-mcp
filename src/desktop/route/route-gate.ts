// src/desktop/route/route-gate.ts
//
// The flag-gated deflection GATE (Slice B, adapted from a2td src/server/route-gate.ts).
// Flag-gated (ROUTE_ENFORCEMENT, default OFF), fail-open, additive: on a scratch-path ENTRY
// tool it either lets the call proceed (returns null) or returns a typed deflection to be
// RETURNED INSTEAD of executing — steering template asks through caller-owned selection and
// one-shot artifact apply, or
// supported refinements through their existing fast lane.
//
// SESSION-KEYED (constraint 1): tmcp has no episodes, so — unlike a2td, which pre-computed the
// route at begin-episode and had the gate merely READ it — this gate CLASSIFIES the ask on
// demand (via `classifyAskRoute`) and dedups per (session, ask) through the session route
// state. Deflection text is generated at runtime; nothing is added to the tools/list surface.
//
// REPEAT INVARIANT: template-routed scratch mutations remain deflected, while supported refine
// operations keep their one-shot override. Repeated template deflections reuse one state record.
//
// WIRING: `checkRouteGate` remains the ask-driven entry point. `checkRouteGateForScratchEntry`
// is the no-ask wiring path for structured slow-path tools: it reads the most recent
// bind-template classification from session state and never classifies at the scratch tool, so
// no ask param is added to the frozen tools/list surface. Flag-off inertness holds regardless.

import { loadManifests } from '../binder/manifest.js';
import type { TemplateManifest } from '../binder/manifest-types.js';
import { type AskShape, classifyAskRoute, normalizeAskForMatch } from '../binder/route-spec.js';
import { type RouteDeflection, type RouteOverride, sessionRouteState } from './route-state.js';

/** The env flag that turns the gate on. Values on/off; DEFAULT OFF. */
export const ROUTE_ENFORCEMENT_ENV = 'ROUTE_ENFORCEMENT';

/** The tmcp tools the gate steers toward (no `tableau-` prefix, per tmcp naming). */
export const LIST_TEMPLATES_TOOL = 'list-templates';
export const BUILD_TEMPLATE_ARTIFACT_TOOL = 'build-worksheets-from-templates';
export const APPLY_TEMPLATE_ARTIFACT_TOOL = 'apply-worksheet';
export const REFINE_WORKSHEET_TOOL = 'refine-worksheet';

/**
 * Whether route enforcement is on. Canonical value is "on", matched case-insensitively.
 * Anything else — including unset — is OFF (the safe default: the product ships OFF; an eval
 * harness sets it ON).
 */
export function routeEnforcementEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env[ROUTE_ENFORCEMENT_ENV] ?? '').trim().toLowerCase() === 'on';
}

export type RouteGateDecision = 'noop' | 'deflect' | 'override';

/** The refine shapes the tmcp refine-worksheet fast lane actually supports (Slice A). */
const REFINE_GATE_SHAPES: ReadonlySet<AskShape> = new Set<AskShape>([
  'refine-top-n',
  'refine-sort',
]);

function isRefineGateShape(shape: AskShape): shape is 'refine-top-n' | 'refine-sort' {
  return REFINE_GATE_SHAPES.has(shape);
}

/**
 * The pure gate decision over a classified ask + whether this (session, ask) was already
 * deflected (flag-independent):
 *   • route is neither bind-first nor refine-op → noop (only routed operations are enforced)
 *   • refine-op but not a supported refine shape → noop (no fast lane to steer toward)
 *   • bind-first                                 → deflect, including repeated scratch calls
 *   • supported refine already deflected        → override (execute; one-shot invariant)
 *   • else                                        → deflect
 */
export function decideRouteGate(args: {
  route: 'bind-first' | 'scratch-pipeline' | 'refine-op' | 'free';
  shape: AskShape;
  alreadyDeflected: boolean;
}): RouteGateDecision {
  const { route, shape, alreadyDeflected } = args;
  if (route !== 'bind-first' && route !== 'refine-op') return 'noop';
  if (route === 'refine-op' && !isRefineGateShape(shape)) return 'noop';
  if (alreadyDeflected && route === 'refine-op') return 'override';
  return 'deflect';
}

/**
 * The single agent-actionable deflection line for a bind-first ask. Names the matched
 * template; contains no newline so it stays one line.
 */
export function deflectionText(template: string): string {
  return (
    `Template '${template}' may fit. Confirm it is a current eligible choice with ` +
    `${LIST_TEMPLATES_TOOL} and load its exact slots. If the template, datasource, mapping, ` +
    `and fresh unique worksheet title are unambiguous, call ${BUILD_TEMPLATE_ARTIFACT_TOOL} ` +
    `and then ${APPLY_TEMPLATE_ARTIFACT_TOOL} exactly once in this turn. If anything is ` +
    'ambiguous or the user asked to hold changes, clarify before building. If the title ' +
    'already exists, choose a new one; this template path never replaces a worksheet or window. ' +
    'Do not retry this scratch mutation or an uncertain apply.'
  );
}

function templateArtifactMarker(template: string): Record<string, unknown> {
  return {
    next_route: 'bind-first',
    next_action: 'template-build-then-apply',
    template,
    discovery_tool: LIST_TEMPLATES_TOOL,
    build_tool: BUILD_TEMPLATE_ARTIFACT_TOOL,
    apply_tool: APPLY_TEMPLATE_ARTIFACT_TOOL,
    target_policy: 'new-worksheet-only',
    clarification_policy: 'before-build-if-ambiguous-held-or-title-conflicts',
    apply_exactly_once: true,
  };
}

export function refineDeflectionText(): string {
  return (
    `Route: refine-op. This is a supported worksheet refinement — call ${REFINE_WORKSHEET_TOOL} ` +
    'first; if it refuses, retry this call and it will proceed.'
  );
}

export interface RouteGateInput {
  /** The scratch-entry tool being gated (recorded in the deflection/override receipt). */
  toolName: string;
  /** The resolved Desktop session id (undefined ⇒ no-op, fail-open). */
  sessionId: string | undefined;
  /** The user's ask/intent VERBATIM — classified on demand to pick the route. */
  ask: string | null | undefined;
  /** Manifest pool to classify against (defaults to the loaded template manifests). */
  manifests?: TemplateManifest[];
  /** Override the env source (tests). */
  env?: NodeJS.ProcessEnv;
}

/**
 * A tool-result envelope: the one agent-actionable line PLUS a trailing structured
 * `next_route` marker as its own text content item (the server's structured-marker
 * convention). `isError: false`: a deflection is an intentional redirect, not a failure.
 *
 * A `type` alias (not `interface`) on purpose: the MCP `CallToolResult` a handler returns has
 * a `[x: string]: unknown` index signature, and only object-literal type aliases get the
 * implicit index signature needed to be assignable to it.
 */
export type RouteGateResult = {
  content: { type: 'text'; text: string }[];
  isError: boolean;
};

/**
 * The tool-facing gate. Returns a deflection result to RETURN INSTEAD of executing, or null to
 * let the call proceed. Classifies the ask on demand and records the deflection / override in
 * the SESSION route state.
 *
 * A no-op (returns null) when: the flag is off; there is no session id; the ask does not
 * classify to an enforced route (bind-first, or a supported refine-op shape). On the
 * second-and-later template-routed call for the same (session, ask), it returns the same
 * deflection without adding duplicate state. Supported refinements keep the one-shot override.
 */
export function checkRouteGate(input: RouteGateInput): RouteGateResult | null {
  if (!routeEnforcementEnabled(input.env)) return null;
  if (!input.sessionId) return null; // fail-open: no session to key state by

  const manifests = input.manifests ?? [...loadManifests().values()];
  const decision = classifyAskRoute(input.ask, manifests);
  const askKey = normalizeAskForMatch((input.ask ?? '').trim());

  const alreadyDeflected = sessionRouteState.hasDeflection(input.sessionId, askKey);
  const gate = decideRouteGate({
    route: decision.route,
    shape: decision.shape,
    alreadyDeflected,
  });
  if (gate === 'noop') return null;

  const ts = new Date().toISOString();

  if (gate === 'override') {
    // One-shot on the override side too: record the override on the FIRST post-deflection
    // execution only. Later calls still execute (return null) but add no further override.
    if (!sessionRouteState.hasOverride(input.sessionId, askKey)) {
      const override: RouteOverride =
        decision.route === 'refine-op'
          ? { tool: input.toolName, ts, ask: askKey, shape: decision.shape }
          : {
              tool: input.toolName,
              ts,
              ask: askKey,
              template: decision.template ?? '(the matched template)',
            };
      sessionRouteState.recordOverride(input.sessionId, override);
    }
    return null;
  }

  // gate === 'deflect'
  if (decision.route === 'refine-op') {
    const text = refineDeflectionText();
    const deflection: RouteDeflection = {
      tool: input.toolName,
      ts,
      ask: askKey,
      shape: decision.shape,
      next_route: 'refine-op',
      text,
    };
    sessionRouteState.recordDeflection(input.sessionId, deflection);
    return {
      content: [
        { type: 'text', text },
        {
          type: 'text',
          text: JSON.stringify({
            next_route: 'refine-op',
            tool: REFINE_WORKSHEET_TOOL,
            shape: decision.shape,
          }),
        },
      ],
      isError: false,
    };
  }

  const template = decision.template ?? '(the matched template)';
  const text = deflectionText(template);
  const deflection: RouteDeflection = {
    tool: input.toolName,
    ts,
    ask: askKey,
    template,
    next_route: 'bind-first',
    text,
  };
  if (!alreadyDeflected) sessionRouteState.recordDeflection(input.sessionId, deflection);
  return {
    content: [
      { type: 'text', text },
      { type: 'text', text: JSON.stringify(templateArtifactMarker(template)) },
    ],
    isError: false,
  };
}

/**
 * The scratch-entry gate for tools that have NO ask text of their own
 * (build-and-apply-worksheet, batch-create-and-cache-sheets). Unlike checkRouteGate, this
 * NEVER classifies — it only reads whatever bind-template already recorded into session route
 * state. Fail-open when the flag is off, no session/current ask exists, or bind-template has
 * already concluded for the current ask.
 */
export function checkRouteGateForScratchEntry(
  toolName: string,
  sessionId: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): RouteGateResult | null {
  if (!routeEnforcementEnabled(env)) return null;
  if (!sessionId) return null;

  const currentAsk = sessionRouteState.get(sessionId)?.current_ask;
  if (!currentAsk || currentAsk.last_outcome !== null) return null;

  const gate = decideRouteGate({
    route: currentAsk.route,
    shape: currentAsk.shape,
    alreadyDeflected: sessionRouteState.hasDeflection(sessionId, currentAsk.ask),
  });
  if (gate === 'noop') return null;

  const ts = new Date().toISOString();

  if (gate === 'override') {
    if (!sessionRouteState.hasOverride(sessionId, currentAsk.ask)) {
      const override: RouteOverride =
        currentAsk.route === 'refine-op'
          ? { tool: toolName, ts, ask: currentAsk.ask, shape: currentAsk.shape }
          : {
              tool: toolName,
              ts,
              ask: currentAsk.ask,
              template: currentAsk.template ?? '(the matched template)',
            };
      sessionRouteState.recordOverride(sessionId, override);
    }
    return null;
  }

  if (currentAsk.route === 'refine-op') {
    const text = refineDeflectionText();
    const deflection: RouteDeflection = {
      tool: toolName,
      ts,
      ask: currentAsk.ask,
      shape: currentAsk.shape,
      next_route: 'refine-op',
      text,
    };
    sessionRouteState.recordDeflection(sessionId, deflection);
    return {
      content: [
        { type: 'text', text },
        {
          type: 'text',
          text: JSON.stringify({
            next_route: 'refine-op',
            tool: REFINE_WORKSHEET_TOOL,
            shape: currentAsk.shape,
          }),
        },
      ],
      isError: false,
    };
  }

  const template = currentAsk.template ?? '(the matched template)';
  const text = deflectionText(template);
  const deflection: RouteDeflection = {
    tool: toolName,
    ts,
    ask: currentAsk.ask,
    template,
    next_route: 'bind-first',
    text,
  };
  const alreadyDeflected = sessionRouteState.hasDeflection(sessionId, currentAsk.ask);
  if (!alreadyDeflected) sessionRouteState.recordDeflection(sessionId, deflection);
  return {
    content: [
      { type: 'text', text },
      { type: 'text', text: JSON.stringify(templateArtifactMarker(template)) },
    ],
    isError: false,
  };
}
