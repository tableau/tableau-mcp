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

import { CANONICAL_DERIVATION_SHORT_FORMS } from '../derivations.js';
import type { DateparseAxisSpec } from '../templates/dateparseTemporalAxis.js';
import type { OptionalFieldPruneSpec } from '../templates/optionalFieldPrune.js';
import {
  buildLlmInput as buildCoreLlmInput,
  classifyNoLlm,
  type EncodingFieldResolution,
  type EncodingReport,
  type LlmProposeInput as CoreLlmProposeInput,
  type LooseFieldReferenceResolution,
  MAX_CLASSIFIABLE_FIELDS,
  resolveEncodingFieldInAsk,
  resolveLooseFieldReference,
} from './classify.js';
import { escapeXml } from './escape.js';
import type { RuntimeTemplateDescriptor } from './manifest-types.js';
import { type SchemaField, type SchemaSummary, summarizeSchema } from './schema-summary.js';
import {
  type BindingProposal,
  type Blocker,
  type EscalateReason,
  type FilterSpec,
  resolveInSummary,
  validateBinding,
} from './validate.js';
import { WATERFALL_ORDER_FIELD_RE, WATERFALL_TEMPLATE_NAME } from './waterfall.js';

// Re-exported as the binder's public surface. Bare (source-less) re-exports of the
// locally-imported bindings — a single `export ... from './x.js'` alongside the
// import above would trip the target's `no-duplicate-imports` (includeExports).
export {
  classifyNoLlm,
  type EncodingFieldResolution,
  type EncodingReport,
  type LooseFieldReferenceResolution,
  MAX_CLASSIFIABLE_FIELDS,
  resolveEncodingFieldInAsk,
  resolveInSummary,
  resolveLooseFieldReference,
  summarizeSchema,
  validateBinding,
  WATERFALL_ORDER_FIELD_RE,
};
export type { BindingProposal, Blocker, EscalateReason, FilterSpec, SchemaField, SchemaSummary };

type ProposeField = CoreLlmProposeInput['fields'][number] & { semanticRole?: string };
type FieldIdentity = Pick<ProposeField, 'name' | 'role' | 'type' | 'datatype'>;

// A waterfall's running total is order-dependent, and its intended P&L order almost always
// lives in a non-displayed sequence column (display_order / sort_order / …). Left to the
// template default (DESC by the bound measure) the bridge is wrong; and asking the model to
// ADD the sort in a later step is fragile (live m1 receipts: it lands the sort only ~1/3 of
// runs, otherwise settling for magnitude order). So the confident bind DEFAULTS the sort to
// that column ascending when one exists and no sort was proposed — one coherent bind, no
// fragile follow-up. The shared constants live in waterfall.ts so classification and apply
// use one definition without creating a classify ↔ binder cycle.
export type LlmProposeInput = Omit<CoreLlmProposeInput, 'fields'> & {
  fields: ProposeField[];
};

function fieldIdentityKey(f: FieldIdentity): string {
  return `${f.name}\0${f.role}\0${f.type}\0${f.datatype}`;
}

/**
 * Re-attach each summary field's semanticRole to the core payload by identity
 * (name/role/type/datatype — the exact tuple the core emits). Two summary
 * fields colliding on the tuple with DIFFERENT semantic roles are ambiguous:
 * tag neither rather than guess.
 *
 * This wrapper intentionally lives outside hash-gated classify.ts.
 */
function enrichSemanticRoles(input: CoreLlmProposeInput, summary: SchemaSummary): LlmProposeInput {
  const semanticRoleByField = new Map<string, string | undefined>();
  const ambiguous = new Set<string>();

  for (const f of summary.fields) {
    const key = fieldIdentityKey(f);
    if (semanticRoleByField.has(key) && semanticRoleByField.get(key) !== f.semanticRole) {
      ambiguous.add(key);
      continue;
    }
    semanticRoleByField.set(key, f.semanticRole);
  }

  return {
    ...input,
    fields: input.fields.map((f) => {
      const key = fieldIdentityKey(f);
      const semanticRole = ambiguous.has(key) ? undefined : semanticRoleByField.get(key);
      return semanticRole ? { ...f, semanticRole } : f;
    }),
  };
}

export function buildLlmInput(
  ask: string,
  manifests: Map<string, RuntimeTemplateDescriptor>,
  summary: SchemaSummary,
  opts?: { maxFields?: number },
): LlmProposeInput {
  return enrichSemanticRoles(buildCoreLlmInput(ask, manifests, summary, opts), summary);
}

/** The validated, injector-ready args for `tableau-inject-template`. */
export interface InjectTemplateArgs {
  template_name: string;
  title: string;
  sheet_type: 'worksheet';
  template_parameters: { DATASOURCE: string } & Record<string, string>;
  field_mapping: Record<string, string>;
  sort?: { by: string; direction: 'asc' | 'desc' };
  top_n?: number;
  /** Histogram-only positive bin width; undefined preserves the authored default. */
  bin_size?: number;
  /** Declarative interactive dimension filters (m7). A context:true filter is emitted at
   * Tableau OoO step 3 so a Top-N within that dimension ranks within the selection. */
  filters?: FilterSpec[];
  /** temporal_axis_from_string: when a temporal slot bound a date-like STRING, the
   * apply path injects a DATEPARSE calc for that slot (see dateparseTemporalAxis.ts). */
  dateparse_axis?: DateparseAxisSpec;
  /** Optional template refs the apply path must remove when their manifest slots are unbound. */
  optional_field_prunes?: OptionalFieldPruneSpec[];
}

export type LlmProposeFn = (input: LlmProposeInput) => Promise<BindingProposal>;

export type DeclineReason = {
  code: 'no_llm_classifier_declined' | 'no_llm_validation_declined';
  detail: string;
};

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
  'Worksheet-path (tier-1 default): create a sheet with tabdoc:new-worksheet, substitute the template worksheet fragment using template_parameters + field_mapping, then tableau-apply-worksheet (no whole-workbook round-trip). The same args also drive the tableau-inject-template + tableau-apply-workbook chain. NOTE: title, template_parameters.DATASOURCE, and every field_mapping value are already XML-escaped for verbatim substitution into (single- or double-quoted) XML attributes — substitute them as-is; do NOT escape them again.';

export type BinderResult =
  | {
      status: 'bound';
      args: InjectTemplateArgs;
      used_llm: boolean;
      apply_hint: ApplyHint;
      apply_instruction: string;
      /** Advisory avoid_when cautions matching the ask; present only when non-empty. Never blocks. */
      warnings?: string[];
      /**
       * Encodings the classifier analyzed, split by what this bind actually filled. The
       * deterministic classifier always supplies this report, including empty arrays when
       * the ask named no optional encodings. A caller that applies this bind must not report
       * completion while `unfilled` is non-empty.
       */
      encodings?: EncodingReport;
    }
  | {
      status: 'propose';
      decline_reason: DeclineReason;
      llm_input: LlmProposeInput;
      output_schema: Record<string, unknown>;
    }
  | { status: 'escalate'; reason: EscalateReason; blockers: Blocker[]; proposal?: BindingProposal };

/**
 * The canonical derivation short-forms (== manifest-types `Derivation`). The
 * `satisfies` guard fails the build if this drifts from the union. Used as the
 * enum for the optional derivation override in both the strict output schema and
 * the `tableau-bind-template` proposal input schema.
 */
export const DERIVATION_SHORT_FORMS = CANONICAL_DERIVATION_SHORT_FORMS;

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
          slot_id: {
            type: 'string',
            description: 'Slot id; include optional slots when the ask/data calls for them.',
          },
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
    sort: {
      type: 'object',
      additionalProperties: false,
      required: ['by', 'direction'],
      properties: {
        by: { type: 'string', description: 'Sort field.' },
        direction: { type: 'string', enum: ['asc', 'desc'], description: 'Sort dir.' },
      },
    },
    top_n: { type: 'integer', minimum: 1, description: 'Top N.' },
    bin_size: {
      type: 'number',
      exclusiveMinimum: 0,
    },
    // Declarative interactive dimension filters (m7 order-of-operations). Set context:true to
    // make a filter a CONTEXT filter (Tableau OoO step 3) so a Top-N within that dimension
    // ranks WITHIN the selected member, not globally-then-filtered. Omit `values` for an
    // interactive enumerate-all control (the m7 case: "let me filter down to one region").
    filters: {
      type: 'array',
      items: {
        type: 'object',
        required: ['field'],
        additionalProperties: false,
        properties: {
          field: { type: 'string', description: 'Field name to filter (from fields).' },
          values: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional member values; omit for an interactive all-members control.',
          },
          context: {
            type: 'boolean',
            description:
              'true = context filter (OoO step 3, before Top-N) so a Top-N within this dimension is scoped to the selection.',
          },
        },
      },
    },
  },
};

const DEFAULT_MIN_CONFIDENCE = 0.6;

function sanitizeTemplateParameters(
  params: Record<string, string> | undefined,
): Record<string, string> {
  if (!params) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (key === 'DATASOURCE' || /^field_base_[1-9]\d*$/.test(key)) continue;
    out[key] = escapeXml(value);
  }
  return out;
}

/**
 * Characters illegal in an XML 1.0 document even when escaped: the C0 control block
 * (U+0000–U+001F) and DEL (U+007F). A title carrying one — NUL especially, which cannot
 * appear in XML at all — would make the substituted worksheet fragment unparseable
 * downstream. The tool boundary (proposalSchema) REJECTS these and the Call-1 generator
 * (makeTitle) STRIPS them; one shared definition so the two surfaces cannot drift
 * (M10 Finding 2). NON-global so `.test()` is stateless (no lastIndex hazard).
 *
 * The character class is assembled at runtime (String.fromCharCode) rather than written
 * as a regex literal so the intentional control chars do not trip eslint no-control-regex
 * — and so this adds NO lint suppression.
 */
const XML_ILLEGAL_TITLE_CHARS =
  Array.from({ length: 0x20 }, (_, i) => String.fromCharCode(i)).join('') +
  String.fromCharCode(0x7f);
export const TITLE_CONTROL_CHAR_RE = new RegExp(`[${XML_ILLEGAL_TITLE_CHARS}]`);
export const TITLE_CONTROL_CHAR_MESSAGE =
  'title must not contain control characters (C0 block U+0000–U+001F or DEL U+007F), which are illegal in XML 1.0 even when escaped';

export function makeTitle(ask: string): string {
  // Collapse whitespace FIRST so the XML-legal whitespace controls (TAB/LF/CR/FF/VT ∈ \s)
  // become a single space, THEN strip any remaining C0/DEL control chars (NUL etc.) — so
  // the Call-1 generated title is always XML-safe and agrees with proposalSchema's reject.
  const trimmed = ask
    .trim()
    .replace(/\s+/g, ' ')
    .replace(new RegExp(TITLE_CONTROL_CHAR_RE.source, 'g'), '');
  if (!trimmed) return 'Untitled';
  if (trimmed.length <= 80) return trimmed;
  // Cut on a word boundary and mark the cut. A hard 80-char slice named the live symbol map
  // "...Goals For (bigger and", which reads like a finished description of a chart that was
  // never built — the missing color encoding hid inside a sentence nobody could parse.
  const head = trimmed.slice(0, 79);
  const lastSpace = head.lastIndexOf(' ');
  const kept = lastSpace >= 40 ? head.slice(0, lastSpace) : head;
  return `${kept.replace(/[\s,;:.—–-]+$/, '')}…`;
}

/**
 * Validate a concrete proposal against its manifest and, on success, build the
 * injector-ready args. Shared by Call 2 (agent proposal), the no-LLM Call 1 path,
 * and the eval-only injected-LLM path.
 */
function validateAndBuild(
  proposal: BindingProposal,
  manifests: Map<string, RuntimeTemplateDescriptor>,
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
        detail:
          `template '${m.template}' is not structurally eligible` +
          (m.fast_path_blockers.length > 0 ? `: ${m.fast_path_blockers.join('; ')}` : ''),
      },
    ];
    return { status: 'escalate', reason: 'not-fast-path', blockers, proposal };
  }

  if (
    proposal.bin_size !== undefined &&
    (m.template !== 'distribution-histogram' ||
      !Number.isFinite(proposal.bin_size) ||
      proposal.bin_size <= 0)
  ) {
    return {
      status: 'escalate',
      reason: 'kind-mismatch',
      blockers: [
        {
          code: 'kind-mismatch',
          detail:
            m.template === 'distribution-histogram'
              ? 'histogram bin_size must be a positive finite number'
              : 'bin_size is supported only by distribution-histogram',
        },
      ],
      proposal,
    };
  }

  const v = validateBinding(m, proposal, summary, ask);
  if (!v.ok) {
    const reason = (v.blockers[0]?.code as EscalateReason) ?? 'missing-required-slot';
    return { status: 'escalate', reason, blockers: v.blockers, proposal };
  }

  const warnings = [...(v.warnings ?? [])];
  let sort = proposal.sort;
  if (proposal.sort) {
    const sortField = resolveInSummary(summary, proposal.sort.by);
    if (sortField.kind === 'ambiguous') {
      warnings.push(
        `"${proposal.sort.by}" matches ${sortField.candidates?.length ?? 0} sort fields; ignoring optional sort and keeping the template's default sort`,
      );
      sort = undefined;
    } else if (sortField.kind === 'not_found' || !sortField.field) {
      warnings.push(
        `no sort.by field named "${proposal.sort.by}" in datasource(s); ignoring optional sort and keeping the template's default sort`,
      );
      sort = undefined;
    }
  }

  // Waterfall step-order default: if no usable sort was proposed and the schema carries a
  // sequence/order column, sort the bridge by it ascending in THIS bind — see the note on
  // WATERFALL_ORDER_FIELD_RE. Only when the column resolves unambiguously; otherwise leave the
  // template default (never guess). This is the deterministic fix for m1's sort-lands-~1/3 miss.
  if (!sort && m.template === WATERFALL_TEMPLATE_NAME) {
    const orderFields = summary.fields.filter((f) => WATERFALL_ORDER_FIELD_RE.test(f.name));
    if (orderFields.length > 1) {
      return {
        status: 'escalate',
        reason: 'kind-mismatch',
        blockers: [
          {
            code: 'kind-mismatch',
            detail:
              `waterfall has multiple order fields (${orderFields.map((field) => `"${field.name}"`).join(', ')}); ` +
              'set proposal.sort explicitly',
          },
        ],
        proposal,
      };
    }
    const orderField = orderFields[0];
    if (orderField) {
      const resolved = resolveInSummary(summary, orderField.name);
      if ((resolved.kind === 'exact' || resolved.kind === 'rewritten') && resolved.field) {
        sort = { by: orderField.name, direction: 'asc' };
        warnings.push(
          `waterfall step order defaulted to "${orderField.name}" ascending (running total is order-dependent); pass proposal.sort to override`,
        );
      }
    }
  }

  if (proposal.top_n !== undefined && (!Number.isInteger(proposal.top_n) || proposal.top_n < 1)) {
    return {
      status: 'escalate',
      reason: 'kind-mismatch',
      blockers: [{ code: 'kind-mismatch', detail: 'top_n must be a positive integer' }],
      proposal,
    };
  }

  // Declarative interactive filters (m7). Every requested filter must resolve to one real
  // dimension. Applying the chart after dropping one would silently change the user's ask.
  // The apply-side splice (bindTemplate.applyProposalSplices) re-resolves the accepted field
  // to its CI, declares the dependency, and emits the context filter + shown card.
  if (proposal.filters && proposal.filters.length > 0) {
    for (const filter of proposal.filters) {
      const r = resolveInSummary(summary, filter.field);
      if (r.kind === 'ambiguous') {
        return {
          status: 'escalate',
          reason: 'ambiguous-field',
          blockers: [
            {
              code: 'ambiguous-field',
              detail: `filter field "${filter.field}" matches ${r.candidates?.length ?? 0} fields; use one datasource-qualified field`,
              candidates: (r.candidates ?? []).slice(0, 5).map((candidate) => candidate.column_ref),
            },
          ],
          proposal,
        };
      }
      if (r.kind === 'not_found' || !r.field) {
        return {
          status: 'escalate',
          reason: 'field-not-found',
          blockers: [
            {
              code: 'field-not-found',
              detail: `no filter field named "${filter.field}" in datasource(s)`,
              candidates: (r.candidates ?? []).slice(0, 5).map((candidate) => candidate.column_ref),
            },
          ],
          proposal,
        };
      }
      if (r.field.role !== 'dimension') {
        return {
          status: 'escalate',
          reason: 'kind-mismatch',
          blockers: [
            {
              code: 'kind-mismatch',
              detail: `filter field "${filter.field}" is a measure, not a dimension; interactive filters require dimensions`,
              candidates: [r.field.column_ref],
            },
          ],
          proposal,
        };
      }
    }
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
    // SECURITY (M10 Finding 1): the title is proposal/caller-controlled and substituted
    // verbatim into an XML attribute — escape it here, at the single point it enters the
    // returned payload. datasource + field_mapping arrive PRE-escaped from validateBinding
    // (escaped exactly once at their production), so they are NOT re-escaped here.
    title: escapeXml(proposal.title),
    sheet_type: 'worksheet',
    template_parameters: {
      ...sanitizeTemplateParameters(proposal.template_parameters),
      DATASOURCE: v.datasource,
    },
    field_mapping: v.field_mapping,
    ...(sort ? { sort } : {}),
    ...(proposal.top_n !== undefined ? { top_n: proposal.top_n } : {}),
    ...(proposal.bin_size !== undefined ? { bin_size: proposal.bin_size } : {}),
    ...(proposal.filters && proposal.filters.length > 0 ? { filters: proposal.filters } : {}),
    ...(v.dateparse_axis ? { dateparse_axis: v.dateparse_axis } : {}),
    ...(v.optional_field_prunes ? { optional_field_prunes: v.optional_field_prunes } : {}),
  };
  return {
    status: 'bound',
    args,
    used_llm: usedLlm,
    apply_hint: APPLY_HINT,
    apply_instruction: APPLY_INSTRUCTION,
    ...(warnings.length > 0 ? { warnings } : {}),
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
  manifests: Map<string, RuntimeTemplateDescriptor>;
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

  // ── FAIL-CLOSED cost guard (M10 Finding 3) ───────────────────────
  // classifyNoLlm + buildLlmInput run one regex PER schema field (maskFieldNames /
  // matchFieldsInAsk / narrowFields), uncapped — a pathological wide schema (~50k fields
  // ≈ 2.9s of synchronous event-loop block) is a per-call DoS. Over the cap we do NOT
  // classify a truncated subset (which would risk a silent wrong bind); we escalate
  // honestly (bounded time — this returns BEFORE the per-field hot loop) so the caller
  // routes to the general authoring flow. Call-2 above is intentionally NOT capped: a
  // filled proposal resolves only its handful of bound fields and never hits the loop.
  if (summary.fields.length > MAX_CLASSIFIABLE_FIELDS) {
    return {
      status: 'escalate',
      reason: 'schema-too-large',
      blockers: [
        {
          code: 'schema-too-large',
          detail: `schema-too-large: ${summary.fields.length} fields > ${MAX_CLASSIFIABLE_FIELDS} cap`,
        },
      ],
    };
  }

  // ── Call 1: no-LLM fast path ─────────────────────────────────────
  const cls = classifyNoLlm(args.ask, args.manifests, summary);
  let declineReason: DeclineReason = {
    code: 'no_llm_classifier_declined',
    detail: 'classifyNoLlm returned no deterministic template; routed to proposal candidates',
  };
  if (cls) {
    const proposal: BindingProposal = {
      template: cls.template,
      title: makeTitle(args.ask),
      bindings: cls.bindings,
      ...(cls.top_n !== undefined ? { top_n: cls.top_n } : {}),
      ...(cls.filters ? { filters: cls.filters } : {}),
    };
    const res = validateAndBuild(proposal, args.manifests, summary, minConfidence, false, args.ask);
    if (res.status === 'bound') {
      // Surface the classifier's advisory provenance (e.g. a required geo slot
      // auto-completed from the schema, W60) alongside any avoid_when warnings, using
      // the bound result's existing `warnings` channel — never a blocker.
      if (cls.notes && cls.notes.length > 0) {
        res.warnings = [...(res.warnings ?? []), ...cls.notes];
      }
      // Carry the classifier's own filled/unfilled encoding split to the caller. The binder
      // is the only layer that knows an ask named an encoding it could not bind; a post-apply
      // readback cannot recover it, because the XML it would read back never contained the
      // node in the first place.
      if (cls.encodings) {
        res.encodings = cls.encodings;
      }
      return res;
    }
    declineReason = {
      code: 'no_llm_validation_declined',
      detail:
        res.status === 'escalate'
          ? `classifyNoLlm selected '${cls.template}', but deterministic validation declined (${res.reason})`
          : `classifyNoLlm selected '${cls.template}', but deterministic validation did not bind`,
    };
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
    decline_reason: declineReason,
    llm_input: buildLlmInput(args.ask, args.manifests, summary),
    output_schema: PROPOSAL_OUTPUT_SCHEMA,
  };
}
