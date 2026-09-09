import { DesktopMcpServer } from '../server.desktop.js';
import { WebMcpServer } from '../server.web.js';
import { testProductVersion } from '../testShared.js';
import { desktopToolFactories } from './desktop/tools.js';
import { TOOL_ALLOWLISTED_KINDS, utteranceToolMetaFromWire } from './desktop/utterance.js';
import { webToolFactories } from './web/tools.js';

const MARKED_TOOL_NAMES = [
  'ask-user',
  'generate-pulse-metric-value-insight-bundle',
  'get-summary-data',
  'query-datasource',
] as const;

describe('tool utterance allowlist', () => {
  it('marks only the four tools and never declares answer', async () => {
    const desktop = desktopToolFactories.map((factory) => factory(new DesktopMcpServer()));
    const web = await Promise.all(
      webToolFactories.map((factory) => factory(new WebMcpServer(), testProductVersion)),
    );
    const marked: string[] = [];
    for (const tool of [...desktop, ...web]) {
      const utteranceMeta = tool.meta?.utterance;
      if (utteranceMeta === undefined) {
        continue;
      }
      marked.push(tool.name);
      const parsed = utteranceToolMetaFromWire(utteranceMeta);
      expect(TOOL_ALLOWLISTED_KINDS).toContain(parsed.defaultKind);
      expect(parsed.defaultKind).not.toBe('answer');
    }
    expect(marked.sort()).toEqual([...MARKED_TOOL_NAMES].sort());
  });
});
