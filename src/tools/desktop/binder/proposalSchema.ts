import { z } from 'zod';

import {
  DERIVATION_OVERRIDE_INSTRUCTION,
  DERIVATION_SHORT_FORMS,
} from '../../../desktop/binder/binder.js';

// SHARED binder proposal contract. bind-template (Call-2 validate) and validate-proposal
// both accept a filled BindingProposal, so the zod shape lives in ONE place. A divergence
// between two copies is exactly the fail-open the watch-class audit guards against — a
// laxer copy would let a proposal slip past a gate the stricter tool enforces (over-long
// title, missing confidence). One source of truth makes drift impossible.
//
// The snake_case inside `bindings` mirrors the binder library's public data contract
// (`BindingProposal` / `PROPOSAL_OUTPUT_SCHEMA`) VERBATIM so a Call-1 `propose` payload
// round-trips into a filled `proposal` unchanged. That is a serialized library data
// contract, NOT tool ergonomics — the top-level tool params stay camelCase per AGENTS.md.

// WATCH-CLASS (strictness): both objects are `.strict()`. PROPOSAL_OUTPUT_SCHEMA (and the
// advertised JSON schema derived from these) declares `additionalProperties: false`, but a
// bare z.object silently STRIPS unknown keys at runtime — laxer than the advertised
// contract. `.strict()` makes an unknown key a parse ERROR so runtime matches the promise:
// a proposal that smuggles an extra field (a typo'd slot key, a stray override) fails
// closed instead of being quietly accepted with the extra dropped.
export const bindingSchema = z
  .object({
    slot_id: z
      .string()
      .describe(
        "A slot_id from the chosen template's bindable slots (see llm_input.candidate_templates).",
      ),
    field: z
      .string()
      .describe('The exact field NAME (from llm_input.fields) to bind to this slot.'),
    derivation: z
      .enum(DERIVATION_SHORT_FORMS)
      .optional()
      .describe(
        `Optional per-slot aggregation/date-grain override (canonical short form). ${DERIVATION_OVERRIDE_INSTRUCTION}.`,
      ),
  })
  .strict();

export const proposalSchema = z
  .object({
    template: z.string().describe('The chosen template name (from llm_input.candidate_templates).'),
    // WATCH-CLASS (length): the library copies proposal.title VERBATIM on the validate path
    // (validateAndBuild -> InjectTemplateArgs.title) with NO truncation — only the no-LLM
    // Call-1 title is capped (makeTitle). The library's own declared contract
    // (PROPOSAL_OUTPUT_SCHEMA.title.maxLength = 80) is the sole enforcer, so mirror it at the
    // tool boundary or a filled proposal slips an over-long title straight past the gate.
    title: z.string().max(80).describe('Worksheet title (<= 80 chars).'),
    bindings: z
      .array(bindingSchema)
      .describe('One entry per bindable slot: slot_id -> field name.'),
    // WATCH-CLASS (required): required, matching PROPOSAL_OUTPUT_SCHEMA. The binder's floor
    // check SKIPS an undefined confidence, so an optional field here would let a proposal
    // bypass the low-confidence escalation entirely (fail-open). The source implementation's own tool schema left
    // this optional; the repo hardens it to required.
    confidence: z.number().min(0).max(1).describe('0..1 self-rated confidence.'),
  })
  .strict();
