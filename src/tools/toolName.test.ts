import { desktopToolNames, isDesktopToolName } from './desktop/toolName.js';
import { toolNames } from './toolName.js';
import { isWebToolName, webToolNames } from './web/toolName.js';

describe('ToolName', () => {
  it('registers each dialog tool name exactly once', () => {
    for (const toolName of ['get-active-dialogs', 'invoke-dialog-action'] as const) {
      expect(desktopToolNames.filter((name) => name === toolName)).toHaveLength(1);
      expect(isDesktopToolName(toolName)).toBe(true);
    }
  });

  it('should verify all tool names are unique and accounted for', () => {
    const variants = {
      desktop: {
        toolNames: desktopToolNames,
        isToolName: isDesktopToolName,
      },
      web: {
        toolNames: webToolNames,
        isToolName: isWebToolName,
      },
    };

    for (const [variantA, { toolNames: toolNamesA }] of Object.entries(variants)) {
      for (const [variantB, { isToolName: isToolNameB }] of Object.entries(variants)) {
        if (variantA === variantB) {
          continue;
        }

        for (const toolName of toolNamesA) {
          expect(
            isToolNameB(toolName),
            `Tool "${toolName}" from the "${variantA}" variant is already a tool in the "${variantB}" variant`,
          ).toBe(false);
        }
      }
    }

    for (const toolName of toolNames) {
      expect(
        [isWebToolName, isDesktopToolName].some((isVariantToolName) => isVariantToolName(toolName)),
        'This test needs updating. Did you add a new variant?',
      ).toBe(true);
    }
  });
});
