import { Ok } from 'ts-results-es';

import * as getWorksheetXmlCmd from '../../../desktop/commands/workbook/getWorksheetXml.js';
import * as loadWorksheetXmlCmd from '../../../desktop/commands/workbook/loadWorksheetXml.js';
import { sessionRouteState } from '../../../desktop/route/route-state.js';
import {
  DesktopMcpServer,
  DYNAMIC_AUTHORING_TOOL_PROFILE,
  selectToolsForProfile,
} from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { TableauDesktopRequestHandlerExtra } from '../toolContext.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { desktopToolFactories } from '../tools.js';
import { getApplyWorksheetTool } from '../worksheet/applyWorksheet.js';
import { getGetWorksheetXmlTool } from '../worksheet/getWorksheetXml.js';
import { getReadCachedXmlTool } from './readCachedXml.js';
import { getWriteCachedXmlTool } from './writeCachedXml.js';

vi.mock('fs');
vi.mock('../../../desktop/commands/workbook/getWorksheetXml.js');
vi.mock('../../../desktop/commands/workbook/loadWorksheetXml.js');

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';

const store = new Map<string, string>();

// The one place a served tool may still take XML text: write-cached-xml splices the
// content into an existing cached file. It is a slice, addressed by selector — not a
// document the model must retype.
const XML_TEXT_PARAM_ALLOWLIST: Readonly<Record<string, readonly string[]>> = {
  'write-cached-xml': ['xmlContent'],
};

function extra(): TableauDesktopRequestHandlerExtra {
  return { ...getMockRequestHandlerExtra(), getExecutor: vi.fn().mockResolvedValue({}) };
}

describe('no served tool accepts a whole document', () => {
  it('exposes no XML-text parameter outside the cache-splice allowlist', async () => {
    const tools = selectToolsForProfile(
      desktopToolFactories.map((factory) => factory(new DesktopMcpServer())),
      'dynamic-authoring',
    );

    const offenders: string[] = [];
    for (const tool of tools) {
      const paramsSchema = (await Provider.from(tool.paramsSchema)) as Record<string, unknown>;
      const allowed = XML_TEXT_PARAM_ALLOWLIST[tool.name] ?? [];
      for (const param of Object.keys(paramsSchema)) {
        if (/xml/i.test(param) && !allowed.includes(param)) {
          offenders.push(`${tool.name}.${param}`);
        }
      }
    }

    // Wall time tracks OUTPUT tokens: a parameter that accepts a document is an
    // invitation for the model to type one. The cached file path is the handle.
    expect(offenders).toEqual([]);
  });

  it('keeps the whole cache-splice route inside the served profile', () => {
    for (const tool of [
      'get-worksheet-xml',
      'read-cached-xml',
      'write-cached-xml',
      'apply-worksheet',
    ]) {
      expect(DYNAMIC_AUTHORING_TOOL_PROFILE.has(tool as never)).toBe(true);
    }
  });
});

describe('the served profile still has a working edit path with no document parameter', () => {
  const SHEET = "<worksheet name='Sales'><table><rows>[Sales]</rows></table></worksheet>";

  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
    sessionRouteState.clear();
    sessionRouteState.recordAuthoringAttempt('s1', 'bind-template');
    vi.mocked(mkdirSync).mockReturnValue(undefined);
    vi.mocked(existsSync).mockImplementation((p) => store.has(String(p)));
    vi.mocked(readFileSync).mockImplementation((p) => {
      const value = store.get(String(p));
      if (value === undefined) {
        throw new Error(`ENOENT: no such file ${String(p)}`);
      }
      return value;
    });
    vi.mocked(writeFileSync).mockImplementation((p, data) => {
      store.set(String(p), String(data));
    });
  });

  it('runs the post-bind get -> slice-read -> splice-write -> apply(file) repair path', async () => {
    vi.spyOn(getWorksheetXmlCmd, 'getWorksheetXml').mockResolvedValue(Ok(SHEET));
    const loadSpy = vi
      .spyOn(loadWorksheetXmlCmd, 'loadWorksheetXml')
      .mockResolvedValue(Ok({ validationWarnings: [], readbackWarnings: [] }));

    const getCb = await Provider.from(getGetWorksheetXmlTool(new DesktopMcpServer()).callback);
    const getResult = await getCb({ session: 's1', worksheetName: 'Sales', mode: 'file' }, extra());
    invariant(getResult.content[0].type === 'text');
    const file = [...store.keys()].find((key) => !key.endsWith('.session'));
    invariant(file, 'get-worksheet-xml must mint a cache file the agent can address');
    expect(getResult.content[0].text).toContain(file);

    const readCb = await Provider.from(getReadCachedXmlTool(new DesktopMcpServer()).callback);
    const readResult = await readCb(
      {
        filePath: file,
        worksheet: 'Sales',
        dashboard: undefined,
        startByte: undefined,
        endByte: undefined,
      },
      extra(),
    );
    invariant(readResult.content[0].type === 'text');
    expect(readResult.content[0].text).toContain('[Sales]');

    const writeCb = await Provider.from(getWriteCachedXmlTool(new DesktopMcpServer()).callback);
    const writeResult = await writeCb(
      {
        session: 's1',
        filePath: file,
        xmlContent:
          "<worksheet name='Sales'><table><rows>[Sales Modified]</rows></table></worksheet>",
        worksheet: 'Sales',
        dashboard: undefined,
      },
      extra(),
    );
    expect(writeResult.isError).toBeFalsy();

    const applyCb = await Provider.from(getApplyWorksheetTool(new DesktopMcpServer()).callback);
    const applyResult = await applyCb(
      { session: 's1', artifactId: undefined, worksheetName: 'Sales', worksheetFile: file },
      extra(),
    );
    expect(applyResult.isError).toBeFalsy();
    expect((loadSpy.mock.calls[0][0] as { xml: string }).xml).toContain('[Sales Modified]');
  });
});
