import { desktopToolNames, isDesktopToolName } from './desktop/toolName';
import { toolNames } from './toolName';
import { isWebToolName, webToolNames } from './web/toolName';

describe('ToolName', () => {
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
