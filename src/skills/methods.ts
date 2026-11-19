import { ProtocolError, ProtocolErrorCode } from '@modelcontextprotocol/server';
import type { McpServer } from '@modelcontextprotocol/server';
import { InvalidSkillsCursorError } from './cursor.js';
import { type SkillRegistry } from './registry.js';
import {
  SkillsGetHandlerRequestSchema,
  SkillsGetRequestSchema,
  type SkillsGetResult,
  SkillsListHandlerRequestSchema,
  SkillsListRequestSchema,
  type SkillsListResult,
} from './types.js';

/**
 * Registers the skills request handlers on the given server, backed by the registry.
 */
export function registerSkillMethodHandlers(mcp: McpServer, registry: SkillRegistry): void {
  /* @mcp-codemod-error Custom method handler: setRequestHandler(SkillsListHandlerRequestSchema, ...). In v2, use the 3-arg form: setRequestHandler('method/name', { params, result? }, handler). See docs/migration/upgrade-to-v2.md for details. */
  mcp.server.setRequestHandler(
    SkillsListHandlerRequestSchema,
    async (request): Promise<SkillsListResult> => {
      const parsed = SkillsListRequestSchema.safeParse(request);
      if (!parsed.success) {
        throw new ProtocolError(ProtocolErrorCode.InvalidParams, 'Invalid skills/list params');
      }
      try {
        // resultType stays 'complete' per the skills spec, even for a partial page
        return { resultType: 'complete', ...registry.list(parsed.data.params?.cursor) };
      } catch (error) {
        if (error instanceof InvalidSkillsCursorError) {
          throw new ProtocolError(ProtocolErrorCode.InvalidParams, 'Invalid cursor');
        }
        throw error;
      }
    },
  );

  /* @mcp-codemod-error Custom method handler: setRequestHandler(SkillsGetHandlerRequestSchema, ...). In v2, use the 3-arg form: setRequestHandler('method/name', { params, result? }, handler). See docs/migration/upgrade-to-v2.md for details. */
  mcp.server.setRequestHandler(
    SkillsGetHandlerRequestSchema,
    async (request): Promise<SkillsGetResult> => {
      const parsed = SkillsGetRequestSchema.safeParse(request);
      if (!parsed.success) {
        throw new ProtocolError(
          ProtocolErrorCode.InvalidParams,
          'skills/get requires a string uri parameter',
        );
      }
      const { uri } = parsed.data.params;
      const skill = registry.get(uri);
      if (!skill) {
        throw new ProtocolError(ProtocolErrorCode.InvalidParams, `Skill ${uri} not found`);
      }
      return { resultType: 'complete', skill };
    },
  );
}
