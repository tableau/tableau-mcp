import { Ok } from 'ts-results-es';

import * as getWorkbookXmlCmd from '../../../desktop/commands/workbook/getWorkbookXml.js';
import * as loadWorkbookXmlCmd from '../../../desktop/commands/workbook/loadWorkbookXml.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { TableauDesktopRequestHandlerExtra } from '../toolContext.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getApplyWorkbookTool } from '../workbook/applyWorkbook.js';
import { getGetWorkbookXmlTool } from '../workbook/getWorkbookXml.js';
import { getReadCachedXmlTool } from './readCachedXml.js';
import { getWriteCachedXmlTool } from './writeCachedXml.js';

// In-memory filesystem shared across tools: a cache file one tool writes is visible to the
// next. This models a client with NO local filesystem access — the whole edit loop runs
// through the server's own tools (get -> slice-read -> targeted write -> apply).
vi.mock('fs');
vi.mock('../../../desktop/commands/workbook/getWorkbookXml.js');
vi.mock('../../../desktop/commands/workbook/loadWorkbookXml.js');

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';

const store = new Map<string, string>();

const SALES = "<worksheet name='Sales'><table><rows>[Sales]</rows></table></worksheet>";
const PROFIT = "<worksheet name='Profit'><table><rows>[Profit]</rows></table></worksheet>";
// Padding pushes the workbook over the 16 KiB inline cap while keeping it well-formed.
const PADDING = `<pad>${'x'.repeat(20000)}</pad>`;
const WORKBOOK = `<workbook><worksheets>${SALES}${PROFIT}</worksheets>${PADDING}</workbook>`;

function extra(): TableauDesktopRequestHandlerExtra {
  return { ...getMockRequestHandlerExtra(), getExecutor: vi.fn().mockResolvedValue({}) };
}

describe('no-dead-end file workflow for a filesystem-less client', () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
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

  it('supports get(capped) -> slice-read -> targeted write -> apply(file) with only server tools', async () => {
    vi.spyOn(getWorkbookXmlCmd, 'getWorkbookXml').mockResolvedValue(Ok(WORKBOOK));
    const loadSpy = vi.spyOn(loadWorkbookXmlCmd, 'loadWorkbookXml').mockResolvedValue(Ok.EMPTY);

    // 1) GET: inline requested, but the cap forces file mode. Agent gets a path + summary,
    //    NOT the 20KB workbook.
    const getCb = await Provider.from(getGetWorkbookXmlTool(new DesktopMcpServer()).callback);
    const getResult = await getCb({ session: 's1', mode: 'inline' }, extra());
    invariant(getResult.content[0].type === 'text');
    expect(getResult.content[0].text).not.toContain('[Profit]');
    const file = (JSON.parse(getResult.content[0].text) as { file: string }).file;
    expect(file).toBeTruthy();
    expect(store.has(file)).toBe(true);

    // 2) SLICE-READ: pull just the Sales worksheet, not the whole file.
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
    expect(readResult.content[0].text).not.toContain('[Profit]');
    expect(readResult.content[0].text).not.toContain('xxxxx');

    // 3) TARGETED WRITE: splice a modified Sales worksheet back into the cached file.
    const modifiedSales =
      "<worksheet name='Sales'><table><rows>[Sales Modified]</rows></table></worksheet>";
    const writeCb = await Provider.from(getWriteCachedXmlTool(new DesktopMcpServer()).callback);
    const writeResult = await writeCb(
      {
        session: 's1',
        filePath: file,
        xmlContent: modifiedSales,
        worksheet: 'Sales',
        dashboard: undefined,
      },
      extra(),
    );
    expect(writeResult.isError).toBeFalsy();
    const onDisk = store.get(file)!;
    expect(onDisk).toContain('[Sales Modified]');
    expect(onDisk).toContain('[Profit]'); // sibling untouched
    expect(onDisk).toContain('xxxxx'); // padding untouched

    // 4) APPLY (file mode): applied straight from the cached file — no inline XML anywhere.
    const applyCb = await Provider.from(getApplyWorkbookTool(new DesktopMcpServer()).callback);
    const applyResult = await applyCb(
      { session: 's1', mode: 'file', workbookFile: file, workbookXml: undefined },
      extra(),
    );
    expect(applyResult.isError).toBeFalsy();
    const appliedXml = (loadSpy.mock.calls[0][0] as { xml: string }).xml;
    expect(appliedXml).toContain('[Sales Modified]');
    expect(appliedXml).toContain('[Profit]');
  });
});
