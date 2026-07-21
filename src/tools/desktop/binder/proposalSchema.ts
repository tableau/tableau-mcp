import { z } from 'zod';

import {
  DERIVATION_SHORT_FORMS,
  TITLE_CONTROL_CHAR_MESSAGE,
  TITLE_CONTROL_CHAR_RE,
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
    slot_id: z.string().describe(''),
    field: z.string().describe('Exact field name.'),
    derivation: z.enum(DERIVATION_SHORT_FORMS).optional().describe('Derivation override.'),
  })
  .strict();

export const proposalSchema = z
  .object({
    template: z.string().describe('Template.'),
    // WATCH-CLASS (length): the library copies proposal.title VERBATIM on the validate path
    // (validateAndBuild -> InjectTemplateArgs.title, escaped-only) with NO truncation — only
    // the no-LLM Call-1 title is capped (makeTitle). The library's own declared contract
    // (PROPOSAL_OUTPUT_SCHEMA.title.maxLength = 80) is the sole enforcer, so mirror it at the
    // tool boundary or a filled proposal slips an over-long title straight past the gate.
    // WATCH-CLASS (control chars, M10 Finding 2): the title is substituted verbatim into
    // XML; C0 controls / DEL are illegal in XML 1.0 even when escaped (NUL cannot appear at
    // all), so reject them here. The regex + message are shared with the library's makeTitle
    // strip (TITLE_CONTROL_CHAR_RE) so the tool boundary and the Call-1 generator agree.
    title: z
      .string()
      .max(80)
      .refine((t) => !TITLE_CONTROL_CHAR_RE.test(t), { message: TITLE_CONTROL_CHAR_MESSAGE })
      .describe('Title.'),
    bindings: z.array(bindingSchema).describe('Bindings.'),
    // WATCH-CLASS (required): required, matching PROPOSAL_OUTPUT_SCHEMA. The binder's floor
    // check SKIPS an undefined confidence, so an optional field here would let a proposal
    // bypass the low-confidence escalation entirely (fail-open). The source implementation's own tool schema left
    // this optional; the repo hardens it to required.
    confidence: z.number().min(0).max(1).describe('Confidence.'),
    sort: z
      .object({
        by: z.string(),
        direction: z.enum(['asc', 'desc']),
      })
      .strict()
      .optional(),
    top_n: z.number().int().positive().optional(),
  })
  .strict();
