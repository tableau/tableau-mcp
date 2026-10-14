import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { type SkillRegistry } from './registry.js';
import { SkillsListRequestSchema, type SkillsListResult } from './types.js';

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
}
