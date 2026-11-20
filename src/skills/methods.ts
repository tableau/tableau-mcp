import { type McpServer, ProtocolError, ProtocolErrorCode } from '@modelcontextprotocol/server';

import { InvalidSkillsCursorError } from './cursor.js';
import { type SkillRegistry } from './registry.js';
import {
  SkillsGetRequestSchema,
  type SkillsGetResult,
  SkillsHandlerParamsSchema,
  SkillsListRequestSchema,
  type SkillsListResult,
} from './types.js';

/**
 * Registers the skills request handlers on the given server, backed by the registry.
 */
export function registerSkillMethodHandlers(mcp: McpServer, registry: SkillRegistry): void {
  mcp.server.setRequestHandler(
    'skills/list',
    { params: SkillsHandlerParamsSchema },
    async (params): Promise<SkillsListResult> => {
      const parsed = SkillsListRequestSchema.safeParse({ method: 'skills/list', params });
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

  mcp.server.setRequestHandler(
    'skills/get',
    { params: SkillsHandlerParamsSchema },
    async (params): Promise<SkillsGetResult> => {
      const parsed = SkillsGetRequestSchema.safeParse({ method: 'skills/get', params });
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
