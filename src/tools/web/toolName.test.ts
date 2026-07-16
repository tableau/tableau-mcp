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

// AWS Bedrock enforces a 64-char limit on tool names. When registered as a
// Claude Code plugin, every tool name is prefixed with
// mcp__plugin_<plugin>_<server_key>__ (minimum 22 chars with empty server key),
// leaving at most 42 characters for the tool name itself.
const MAX_TOOL_NAME_LENGTH = 42;

describe('WebToolName', () => {
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

  it('all tool names are within the max length limit', () => {
    for (const name of webToolNames) {
      expect(
        name.length,
        `Tool name "${name}" exceeds ${MAX_TOOL_NAME_LENGTH}-char limit (${name.length} chars)`,
      ).toBeLessThanOrEqual(MAX_TOOL_NAME_LENGTH);
    }
  });
});
