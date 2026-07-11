// src/desktop/route/route-gate.ts
//
// The one-shot deflection GATE (Slice B, adapted from a2td src/server/route-gate.ts).
// Flag-gated (ROUTE_ENFORCEMENT, default OFF), fail-open, additive: on a scratch-path ENTRY
// tool it either lets the call proceed (returns null) or returns a typed deflection to be
// RETURNED INSTEAD of executing — steering the agent to run the fast lane first when a stamped
// template (or a supported refine) already covers the ask.
//
// SESSION-KEYED (constraint 1): tmcp has no episodes, so — unlike a2td, which pre-computed the
// route at begin-episode and had the gate merely READ it — this gate CLASSIFIES the ask on
// demand (via `classifyAskRoute`) and dedups per (session, ask) through the session route
// state. Deflection text is generated at runtime; nothing is added to the tools/list surface.
//
// ONE-SHOT INVARIANT: at most one deflection per (session, ask). A SECOND scratch-entry call
// for the same (session, ask) after a deflection executes and records a `route_override` —
// never a loop.
//
// WIRING: this module is complete and self-contained but is NOT yet called from a live tool
// handler. tmcp's slow-path tools (build-and-apply-worksheet, batch-create-and-cache-sheets,
// plan-dashboard-creation) carry STRUCTURED specs, not a free-text ask, and there is no
// begin-episode entry point at which an ask is captured against a session; adding an ask param
// would grow the frozen tools/list surface. Wiring therefore requires a product decision on
// where the ask enters (see the Slice B report). Flag-off inertness holds regardless.

import { loadManifests } from '../binder/manifest.js';
import type { TemplateManifest } from '../binder/manifest-types.js';
import { type AskShape, classifyAskRoute, normalizeAskForMatch } from '../binder/route-spec.js';
import { type RouteDeflection, type RouteOverride, sessionRouteState } from './route-state.js';

/** The env flag that turns the gate on. Values on/off; DEFAULT OFF. */
export const ROUTE_ENFORCEMENT_ENV = 'ROUTE_ENFORCEMENT';

/** The tmcp fast-lane tools the gate steers toward (no `tableau-` prefix, per tmcp naming). */
export const BIND_TEMPLATE_TOOL = 'bind-template';
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
 *   • already deflected this (session, ask)      → override (execute; one-shot invariant)
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
  if (alreadyDeflected) return 'override';
  return 'deflect';
}

/**
 * The single agent-actionable deflection line for a bind-first ask. Names the matched
 * template; contains no newline so it stays one line.
 */
export function deflectionText(template: string): string {
  return (
    `Route: bind-first. Template '${template}' matches this ask — call ${BIND_TEMPLATE_TOOL} ` +
    'first; if it escalates or proposes, retry this call and it will proceed.'
  );
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
 * second-and-later call for the same (session, ask) it returns null AND records a
 * route_override (the one-shot invariant).
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
  sessionRouteState.recordDeflection(input.sessionId, deflection);
  return {
    content: [
      { type: 'text', text },
      { type: 'text', text: JSON.stringify({ next_route: 'bind-first', template }) },
    ],
    isError: false,
  };
}
