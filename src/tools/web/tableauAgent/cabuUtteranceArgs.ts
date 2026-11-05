import { z } from 'zod';

import { datasourceEntrySchema, localizationSchema } from '../../../sdks/tableau/types/cabu.js';

/**
 * The invariant per-conversation fields CABU needs on every utterance after the first
 * (`scope`, `datasources`, `localization`, `embedded`) -- read from `startConversation`'s response
 * (plus a fixed default localization) and round-tripped by the caller as the opaque `utteranceArgs`
 * token returned by `cabu-start-conversation` and passed into every `cabu-ask` call. Kept out of the
 * conversation-state store's secret half (the `cabuCtx` cookie) deliberately: these fields are not
 * secret, so handing them back to the caller/LLM (instead of hiding them server-side too) lets the
 * tool stay stateless from the MCP server's perspective for everything except the cookie -- see
 * `.work/specs/W-24280234-cabu-tools.md`.
 */
const utteranceArgsFieldsSchema = z.object({
  scope: z.string().optional(),
  datasources: z.array(datasourceEntrySchema),
  localization: localizationSchema,
  embedded: z.boolean().optional(),
});
export type UtteranceArgsFields = z.infer<typeof utteranceArgsFieldsSchema>;

/** Encodes the invariant fields as an opaque base64 JSON token. Not encrypted: not a secret. */
export function encodeUtteranceArgs(fields: UtteranceArgsFields): string {
  return Buffer.from(JSON.stringify(fields), 'utf8').toString('base64');
}

/**
 * Decodes a `utteranceArgs` token, throwing a clear, caller-actionable error (naming
 * `cabu-start-conversation` as the recovery path) if the token is not valid base64 JSON matching the
 * expected shape -- e.g. truncated/hand-edited by the caller, or from an incompatible tool version.
 */
export function decodeUtteranceArgs(utteranceArgs: string): UtteranceArgsFields {
  try {
    const decoded = Buffer.from(utteranceArgs, 'base64').toString('utf8');
    return utteranceArgsFieldsSchema.parse(JSON.parse(decoded));
  } catch {
    throw new Error(
      'utteranceArgs is invalid or corrupted. Start a new conversation with cabu-start-conversation and use the utteranceArgs it returns.',
    );
  }
}
