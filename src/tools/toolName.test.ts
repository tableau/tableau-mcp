import { describe, it } from 'vitest';

import {
  isToolGroupName,
  isToolName,
  ToolGroupName,
  toolGroupNames,
  toolGroups,
  ToolName,
  toolNames,
} from './toolName.js';

describe('toolName', () => {
  it('should validate each tool belongs to a group', () => {
    const toolNamesToGroups = Object.entries(toolGroups).reduce(
      (acc, [group, tools]) => {
        for (const tool of tools) {
          if (isToolName(tool) && isToolGroupName(group)) {
            if (acc[tool]) {
              acc[tool].add(group);
            } else {
              acc[tool] = new Set([group]);
            }
          }
        }
        return acc;
      },
      {} as Record<ToolName, Set<ToolGroupName>>,
    );

    for (const toolName of toolNames) {
      expect(toolNamesToGroups[toolName], `Tool ${toolName} is not in a group`).toBeDefined();
    }
  });

  it('should not allow a tool group to have the same name as a tool', () => {
    for (const group of toolGroupNames) {
      expect(isToolName(group), `Group ${group} is the same as a tool name`).toBe(false);
    }
  });
});
