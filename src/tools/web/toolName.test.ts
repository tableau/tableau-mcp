import { describe, it } from 'vitest';

import {
  isWebToolGroupName,
  isWebToolName,
  WebToolGroupName,
  webToolGroupNames,
  webToolGroups,
  WebToolName,
  webToolNames,
} from './toolName.js';

describe('WebToolName', () => {
  it('registers all knowledge tools in the knowledge group', () => {
    expect(webToolNames).toContain('get-knowledge-suggestions');
    expect(webToolNames).toContain('list-knowledge-sources');
    expect(webToolNames).toContain('search-knowledge-nodes');
    expect(webToolNames).toContain('get-knowledge-node');
    expect(webToolNames).toContain('get-knowledge-node-relationships');
    expect(webToolNames).toContain('get-knowledge-lineage');
    expect(webToolNames).toContain('get-knowledge-node-impact');
    expect(webToolNames).toContain('create-knowledge-semantic-statements');
    expect(webToolNames).toContain('list-knowledge-semantic-statements');
    expect(webToolNames).toContain('update-knowledge-semantic-statements');
    expect(webToolGroupNames).toContain('knowledge');
    expect((webToolGroups as any).knowledge).toEqual([
      'get-knowledge-suggestions',
      'list-knowledge-sources',
      'search-knowledge-nodes',
      'get-knowledge-node',
      'get-knowledge-node-relationships',
      'get-knowledge-lineage',
      'get-knowledge-node-impact',
      'create-knowledge-semantic-statements',
      'list-knowledge-semantic-statements',
      'update-knowledge-semantic-statements',
    ]);
  });

  it('should validate each tool belongs to a group', () => {
    const toolNamesToGroups = Object.entries(webToolGroups).reduce(
      (acc, [group, tools]) => {
        for (const tool of tools) {
          if (isWebToolName(tool) && isWebToolGroupName(group)) {
            if (acc[tool]) {
              acc[tool].add(group);
            } else {
              acc[tool] = new Set([group]);
            }
          }
        }
        return acc;
      },
      {} as Record<WebToolName, Set<WebToolGroupName>>,
    );

    for (const toolName of webToolNames) {
      expect(toolNamesToGroups[toolName], `Tool ${toolName} is not in a group`).toBeDefined();
    }
  });

  it('should not allow a tool group to have the same name as a tool', () => {
    for (const group of webToolGroupNames) {
      expect(isWebToolName(group), `Group ${group} is the same as a tool name`).toBe(false);
    }
  });
});
