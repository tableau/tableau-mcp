import { DesktopMcpServer } from '../server.desktop.js';
import { desktopToolNames, isDesktopToolName } from './desktop/toolName.js';
import { desktopToolFactories, episodeToolFactories } from './desktop/tools.js';
import { isWebToolName, webToolNames } from './web/toolName.js';

/** Names both variants register, each with its own implementation. */
const crossVariantToolNames = new Set<string>(['scaffold-data-app']);

describe('ToolName', () => {
  it('recognizes capture-window-screenshot as a Desktop tool name', () => {
    expect(isDesktopToolName('capture-window-screenshot')).toBe(true);
  });

  it('builds exactly the tool names listed in desktopToolNames, with no duplicates', () => {
    const server = new DesktopMcpServer();
    const factoryNames = [...desktopToolFactories, ...episodeToolFactories].map(
      (factory) => factory(server).name as string,
    );
    const listedNames: string[] = [...desktopToolNames];

    const duplicateOf = (names: string[]): string[] =>
      names.filter((name, i) => names.indexOf(name) !== i);

    expect(duplicateOf(factoryNames)).toEqual([]);
    expect(duplicateOf(listedNames)).toEqual([]);
    expect(listedNames.filter((name) => !factoryNames.includes(name))).toEqual([]);
    expect(factoryNames.filter((name) => !listedNames.includes(name))).toEqual([]);
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

        const overlap = new Set(toolNamesA.filter((toolName) => isToolNameB(toolName)));
        expect(overlap).toEqual(crossVariantToolNames);
      }
    }
  });
});
