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
  it('registers get-knowledge-suggestions in the knowledge group', () => {
    expect(webToolNames).toContain('get-knowledge-suggestions');
    expect(webToolGroupNames).toContain('knowledge');
    expect((webToolGroups as any).knowledge).toEqual(['get-knowledge-suggestions']);
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
