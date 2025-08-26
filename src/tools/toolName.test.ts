import { describe, it } from 'vitest';

import {
  isToolGroupName,
  isToolName,
  ToolGroupName,
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
            acc[tool] = group;
          }
        }
        return acc;
      },
      {} as Record<ToolName, ToolGroupName>,
    );

    for (const toolName of toolNames) {
      expect(toolNamesToGroups[toolName], `Tool ${toolName} is not in a group`).toBeDefined();
    }
  });
});
