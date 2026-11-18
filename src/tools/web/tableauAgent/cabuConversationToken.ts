import { z } from 'zod';

import { datasourceEntrySchema, localizationSchema } from '../../../sdks/tableau/types/cabu.js';

/**
 * Everything `tableau-agent-ask` needs to continue a conversation: the CES `conversationId` plus the
 * invariant fields CES requires on every utterance (`scope`, `datasources`, `localization`,
 * `embedded`). The MCP server keeps no conversation state, so `tableau-agent-start-conversation` returns
 * these to the caller as one opaque token. One token rather than several values means a client
 * can't drop or mismatch part of it. CES keeps the conversation's history itself, keyed by
 * `conversationId`.
 */
const conversationTokenFieldsSchema = z.object({
  conversationId: z.string().nonempty(),
  scope: z.string().optional(),
  datasources: z.array(datasourceEntrySchema),
  localization: localizationSchema,
  embedded: z.boolean().optional(),
});
export type ConversationTokenFields = z.infer<typeof conversationTokenFieldsSchema>;

/** Encodes the fields as an opaque base64 JSON token. Not encrypted: not a secret. */
export function encodeConversationToken(fields: ConversationTokenFields): string {
  return Buffer.from(JSON.stringify(fields), 'utf8').toString('base64');
}

/** Decodes a token, throwing an error that names the recovery path when it is invalid. */
export function decodeConversationToken(conversationToken: string): ConversationTokenFields {
  try {
    const decoded = Buffer.from(conversationToken, 'base64').toString('utf8');
    return conversationTokenFieldsSchema.parse(JSON.parse(decoded));
  } catch {
    throw new Error(
      'conversationToken is invalid or corrupted. Start a new conversation with tableau-agent-start-conversation and use the conversationToken it returns.',
    );
  }
}
