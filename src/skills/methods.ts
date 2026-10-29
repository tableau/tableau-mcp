import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

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
  mcp.server.setRequestHandler(
    SkillsListHandlerRequestSchema,
    async (request): Promise<SkillsListResult> => {
      const parsed = SkillsListRequestSchema.safeParse(request);
      if (!parsed.success) {
        throw new McpError(ErrorCode.InvalidParams, 'skills/list cursor must be a string');
      }
      try {
        // resultType stays 'complete' per the skills spec, even for a partial page
        return { resultType: 'complete', ...registry.list(parsed.data.params?.cursor) };
      } catch (error) {
        if (error instanceof InvalidSkillsCursorError) {
          throw new McpError(ErrorCode.InvalidParams, 'Invalid cursor');
        }
        throw error;
      }
    },
  );

  mcp.server.setRequestHandler(
    SkillsGetHandlerRequestSchema,
    async (request): Promise<SkillsGetResult> => {
      const parsed = SkillsGetRequestSchema.safeParse(request);
      if (!parsed.success) {
        throw new McpError(ErrorCode.InvalidParams, 'skills/get requires a string uri parameter');
      }
      const { uri } = parsed.data.params;
      const skill = registry.get(uri);
      if (!skill) {
        throw new McpError(ErrorCode.InvalidParams, `Skill ${uri} not found`);
      }
      return { resultType: 'complete', skill };
    },
  );
}
