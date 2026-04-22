import {
  DesktopToolGroupName,
  desktopToolGroupNames,
  desktopToolGroups,
  DesktopToolName,
  desktopToolNames,
  isDesktopToolGroupName,
  isDesktopToolName,
} from './toolName';

describe('WebToolName', () => {
  it('should validate each tool belongs to a group', () => {
    const toolNamesToGroups = Object.entries(desktopToolGroups).reduce(
      (acc, [group, tools]) => {
        for (const tool of tools) {
          if (isDesktopToolName(tool) && isDesktopToolGroupName(group)) {
            if (acc[tool]) {
              acc[tool].add(group);
            } else {
              acc[tool] = new Set([group]);
            }
          }
        }
        return acc;
      },
      {} as Record<DesktopToolName, Set<DesktopToolGroupName>>,
    );

    for (const toolName of desktopToolNames) {
      expect(toolNamesToGroups[toolName], `Tool ${toolName} is not in a group`).toBeDefined();
    }
  });

  it('should not allow a tool group to have the same name as a tool', () => {
    for (const group of desktopToolGroupNames) {
      expect(isDesktopToolName(group), `Group ${group} is the same as a tool name`).toBe(false);
    }
  });
});
