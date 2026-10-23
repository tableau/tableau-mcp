import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

import { type SkillRegistry } from './registry.js';
import {
  SkillsGetHandlerRequestSchema,
  SkillsGetRequestSchema,
  type SkillsGetResult,
  SkillsListRequestSchema,
  type SkillsListResult,
} from './types.js';

/**
 * Registers the skills request handlers on the given server, backed by the registry.
 */
export function registerSkillMethodHandlers(mcp: McpServer, registry: SkillRegistry): void {
  mcp.server.setRequestHandler(
    SkillsListRequestSchema,
    async (): Promise<SkillsListResult> => ({
      // resultType is always 'complete' because the full skill catalog is always enumerable
      resultType: 'complete',
      skills: registry.list().skills,
    }),
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
