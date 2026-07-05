// src/binder/binder.ts
//
// Tier-1 fast-path binder — the orchestrator (design doc §3, with the two-call
// protocol correction).
//
// TWO-CALL PROTOCOL (the MCP server stays model-free):
//   • Call 1 — `bindTemplate({ ask, ... })`: run classifyNoLlm + role-greedy
//     binding. If it fully binds AND passes the gate → `{status:"bound"}` with
//     `used_llm:false`. On a miss → `{status:"propose"}` carrying the compact
//     `LlmProposeInput` (§3.3) and the strict JSON `output_schema`, so the
//     CALLING agent produces the BindingProposal itself.
//   • Call 2 — `bindTemplate({ ask, proposal, ... })`: validate the agent's
//     proposal through `validateBinding` (§2.4 gates 1–7) → `{status:"bound"}`
//     or `{status:"escalate", reason, blockers}`.
//
// EVAL-ONLY seam: the pure core still accepts an optional `llmPropose` injection.
// When supplied (and Call 1 missed), the binder calls it and validates the result
// in-process, so the eval harness can exercise the with-LLM path deterministically
// without the two-call round trip. The MCP tool never passes `llmPropose`.

import { buildLlmInput, classifyNoLlm, type LlmProposeInput } from './classify.js';
import type { BlockerCode, Derivation, TemplateManifest } from './manifest-types.js';
import { type SchemaField, type SchemaSummary, summarizeSchema } from './schema-summary.js';
import {
  type BindingProposal,
  type Blocker,
  type EscalateReason,
  validateBinding,
} from './validate.js';

// Re-exported as the binder's public surface. Bare (source-less) re-exports of the
// locally-imported bindings — a single `export ... from './x.js'` alongside the
// import above would trip the target's `no-duplicate-imports` (includeExports).
export { buildLlmInput, classifyNoLlm, summarizeSchema, validateBinding };
export type {
  BindingProposal,
  Blocker,
  EscalateReason,
  LlmProposeInput,
  SchemaField,
  SchemaSummary,
};

/** The validated, injector-ready args for `tableau-inject-template`. */
export interface InjectTemplateArgs {
  template_name: string;
  title: string;
  sheet_type: 'worksheet';
  template_parameters: { DATASOURCE: string } & Record<string, string>;
  field_mapping: Record<string, string>;
}

export type LlmProposeFn = (input: LlmProposeInput) => Promise<BindingProposal>;

/**
 * The tier-1 default APPLY chain is WORKSHEET-LEVEL (live-proven 2026-07-04):
 * create a sheet and apply the substituted template worksheet FRAGMENT — smaller,
 * faster, and free of the whole-workbook round-trip risk (the workbook path had an
 * entity-corruption bug). `args` (InjectTemplateArgs) still carries everything the
 * inject-template + apply-workbook chain needs — `{template_name, title,
 * field_mapping, template_parameters:{DATASOURCE}}` is sufficient for a caller to
 * run EITHER chain from one bound result — so `apply_hint` names the recommended
 * default and `apply_instruction` is the one-line how-to. No apply is implemented
 * here; the binder only produces the validated args + the routing hint.
 */
export type ApplyHint = 'worksheet-path';
export const APPLY_HINT: ApplyHint = 'worksheet-path';
export const APPLY_INSTRUCTION =
  'Worksheet-path (tier-1 default): create a sheet with tabdoc:new-worksheet, substitute the template worksheet fragment using template_parameters + field_mapping, then tableau-apply-worksheet (no whole-workbook round-trip). The same args also drive the tableau-inject-template + tableau-apply-workbook chain.';

export type BinderResult =
  | {
      status: 'bound';
      args: InjectTemplateArgs;
      used_llm: boolean;
      apply_hint: ApplyHint;
      apply_instruction: string;
      /** Advisory avoid_when cautions matching the ask; present only when non-empty. Never blocks. */
      warnings?: string[];
    }
  | { status: 'propose'; llm_input: LlmProposeInput; output_schema: Record<string, unknown> }
  | { status: 'escalate'; reason: EscalateReason; blockers: Blocker[]; proposal?: BindingProposal };

/**
 * The canonical derivation short-forms (== manifest-types `Derivation`). The
 * `satisfies` guard fails the build if this drifts from the union. Used as the
 * enum for the optional derivation override in both the strict output schema and
 * the `tableau-bind-template` proposal input schema.
 */
export const DERIVATION_SHORT_FORMS = [
  'none',
  'sum',
  'avg',
  'cnt',
  'cntd',
  'median',
  'min',
  'max',
  'attr',
  'usr',
  'yr',
  'qr',
  'mn',
  'wk',
  'dy',
  'hr',
  'mi',
  'sc',
  'tyr',
  'tqr',
  'tmn',
  'tdy',
] as const satisfies readonly Derivation[];

/** One-liner shown to the model so it overrides derivations sparingly. */
export const DERIVATION_OVERRIDE_INSTRUCTION =
  'set derivation ONLY when the ask explicitly requests an aggregation/date grain different from the template default';

/**
 * The strict JSON output schema the small-LLM is constrained to (design §3.3).
 * The model picks a template, maps slot_id→field name, titles the sheet, and MAY
 * set an optional per-slot `derivation` override — the ONLY derivation surface it
 * controls. Datasource, instance syntax, and (in the absence of an override) the
 * aggregation are all outside its output, so the deterministic gate can fully
 * verify the result and legality-check any override it does emit.
 */
export const PROPOSAL_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['template', 'title', 'bindings', 'confidence'],
  additionalProperties: false,
  properties: {
    template: { type: 'string' },
    title: { type: 'string', maxLength: 80 },
    bindings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['slot_id', 'field'],
        additionalProperties: false,
        properties: {
          slot_id: { type: 'string' },
          field: { type: 'string' },
          derivation: {
            type: 'string',
            enum: [...DERIVATION_SHORT_FORMS],
            description: `Optional per-slot aggregation/date-grain override (canonical short form). ${DERIVATION_OVERRIDE_INSTRUCTION}.`,
          },
        },
      },
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};

const DEFAULT_MIN_CONFIDENCE = 0.6;

function makeTitle(ask: string): string {
  const trimmed = ask.trim().replace(/\s+/g, ' ');
  if (!trimmed) return 'Untitled';
  return trimmed.length > 80 ? trimmed.slice(0, 80) : trimmed;
}

/**
 * Validate a concrete proposal against its manifest and, on success, build the
 * injector-ready args. Shared by Call 2 (agent proposal), the no-LLM Call 1 path,
 * and the eval-only injected-LLM path.
 */
function validateAndBuild(
  proposal: BindingProposal,
  manifests: Map<string, TemplateManifest>,
  summary: ReturnType<typeof summarizeSchema>,
  minConfidence: number,
  usedLlm: boolean,
  ask: string,
): BinderResult {
  const m = manifests.get(proposal.template);
  if (!m) {
    return {
      status: 'escalate',
      reason: 'template-not-found',
      blockers: [
        { code: 'template-not-found', detail: `no manifest for template '${proposal.template}'` },
      ],
      proposal,
    };
  }
  if (!m.fast_path_eligible) {
    const blockers: Blocker[] = [
      {
        code: 'not-fast-path',
        detail: `template '${m.template}' is not fast-path eligible (readiness=${m.readiness})`,
      },
    ];
    for (const b of m.fast_path_blockers as BlockerCode[]) {
      blockers.push({ code: b, detail: `fast-path blocker: ${b}` });
    }
    return { status: 'escalate', reason: 'not-fast-path', blockers, proposal };
  }

  const v = validateBinding(m, proposal, summary, ask);
  if (!v.ok) {
    const reason = (v.blockers[0]?.code as EscalateReason) ?? 'missing-required-slot';
    return { status: 'escalate', reason, blockers: v.blockers, proposal };
  }

  if (proposal.confidence !== undefined && proposal.confidence < minConfidence) {
    return {
      status: 'escalate',
      reason: 'low-confidence',
      blockers: [
        {
          code: 'low-confidence',
          detail: `confidence ${proposal.confidence} < min ${minConfidence}`,
        },
      ],
      proposal,
    };
  }

  const args: InjectTemplateArgs = {
    template_name: m.template,
    title: proposal.title,
    sheet_type: 'worksheet',
    template_parameters: { DATASOURCE: v.datasource },
    field_mapping: v.field_mapping,
  };
  return {
    status: 'bound',
    args,
    used_llm: usedLlm,
    apply_hint: APPLY_HINT,
    apply_instruction: APPLY_INSTRUCTION,
    ...(v.warnings && v.warnings.length > 0 ? { warnings: v.warnings } : {}),
  };
}

/**
 * Bind a template for `ask`, implementing the two-call protocol.
 * `llmPropose` is the EVAL-ONLY seam; omit it for the model-free (Call 1 →
 * propose) MCP behavior.
 */
export async function bindTemplate(args: {
  ask: string;
  workbookXml: string;
  manifests: Map<string, TemplateManifest>;
  proposal?: BindingProposal;
  llmPropose?: LlmProposeFn;
  minConfidence?: number;
}): Promise<BinderResult> {
  const summary = summarizeSchema(args.workbookXml);
  const minConfidence = args.minConfidence ?? DEFAULT_MIN_CONFIDENCE;

  // ── Call 2: validate the agent-produced proposal ─────────────────
  if (args.proposal) {
    return validateAndBuild(args.proposal, args.manifests, summary, minConfidence, true, args.ask);
  }

  // ── Call 1: no-LLM fast path ─────────────────────────────────────
  const cls = classifyNoLlm(args.ask, args.manifests, summary);
  if (cls) {
    const proposal: BindingProposal = {
      template: cls.template,
      title: makeTitle(args.ask),
      bindings: cls.bindings,
    };
    const res = validateAndBuild(proposal, args.manifests, summary, minConfidence, false, args.ask);
    if (res.status === 'bound') return res;
    // else fall through — the no-LLM guess didn't validate.
  }

  // ── Miss. Eval-only injected LLM closes the loop in-process ───────
  if (args.llmPropose) {
    const input = buildLlmInput(args.ask, args.manifests, summary);
    const proposal = await args.llmPropose(input);
    return validateAndBuild(proposal, args.manifests, summary, minConfidence, true, args.ask);
  }

  // ── Model-free MCP server: hand the propose payload to the agent ──
  return {
    status: 'propose',
    llm_input: buildLlmInput(args.ask, args.manifests, summary),
    output_schema: PROPOSAL_OUTPUT_SCHEMA,
  };
}
