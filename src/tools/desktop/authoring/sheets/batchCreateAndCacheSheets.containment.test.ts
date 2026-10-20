import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Ok } from 'ts-results-es';

import { DesktopMcpServer } from '../../../../server.desktop.js';
import { Provider } from '../../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { distinctCacheId } from '../fields/worksheetCache.js';
import { getBatchCreateAndCacheSheetsTool } from './batchCreateAndCacheSheets.js';

const state = vi.hoisted(() => ({ cacheDir: '' }));

vi.mock('../../../../desktop/cache.js', () => ({
  DesktopCache: class {
    getCacheFilePath({ prefix, id }: { prefix: string; id?: string }): string {
      return join(state.cacheDir, `${prefix}-${id ?? 'default'}.xml`);
    }
  },
}));
vi.mock('../../../../desktop/wrappers/getWorkbookXml.js');
vi.mock('../../../../desktop/wrappers/loadWorkbookXml.js');
vi.mock('../../../../desktop/wrappers/getWorksheetXml.js');
vi.mock('../../../../desktop/wrappers/getDashboardXml.js');
vi.mock('../../../../desktop/metadata/index.js');
vi.mock('../../../../desktop/wrappers/cacheFingerprint.js', () => ({
  sourceSha256: () => 'x',
  writeSidecar: vi.fn(),
}));

import { addDashboard, addSheet } from '../../../../desktop/metadata/index.js';
import { getDashboardXml } from '../../../../desktop/wrappers/getDashboardXml.js';
import { getWorkbookXml } from '../../../../desktop/wrappers/getWorkbookXml.js';
import { getWorksheetXml } from '../../../../desktop/wrappers/getWorksheetXml.js';
import { loadWorkbookXml } from '../../../../desktop/wrappers/loadWorkbookXml.js';

const WORKBOOK_XML = '<?xml version="1.0"?><workbook><worksheets/></workbook>';

describe.skipIf(process.platform === 'win32')('batch-create-and-cache-sheets cache writes', () => {
  let root: string;
  let victim: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'batch-cache-'));
    state.cacheDir = join(root, 'cache');
    mkdirSync(state.cacheDir);
    victim = join(root, 'victim.txt');
    writeFileSync(victim, 'precious');
    vi.mocked(getWorkbookXml).mockResolvedValue(new Ok(WORKBOOK_XML));
    vi.mocked(addSheet).mockReturnValue(WORKBOOK_XML);
    vi.mocked(addDashboard).mockReturnValue(WORKBOOK_XML);
    vi.mocked(loadWorkbookXml).mockResolvedValue(
      new Ok({ validationWarnings: [], documentWarnings: [] }),
    );
    vi.mocked(getWorksheetXml).mockResolvedValue(
      new Ok({ xml: '<worksheet name="Sheet1"/>', name: 'Sheet1' }),
    );
    vi.mocked(getDashboardXml).mockResolvedValue(new Ok({ xml: '<dashboard/>', name: 'DB' }));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  async function run(): Promise<string> {
    const extra = getMockRequestHandlerExtra();
    extra.getExecutor = vi.fn().mockResolvedValue({});
    const tool = getBatchCreateAndCacheSheetsTool(new DesktopMcpServer());
    const callback = await Provider.from(tool.callback);
    const result = await callback(
      { session: '1', worksheetNames: ['Sheet1'], dashboardName: 'DB' },
      extra,
    );
    return JSON.stringify(result);
  }

  it.each([
    ['workbook', 'workbook-for-parallel-build-'],
    ['worksheet', 'worksheet-'],
    ['dashboard', 'dashboard-'],
  ])('refuses a symlink planted at the %s cache target', async (_kind, prefix) => {
    const id =
      prefix === 'workbook-for-parallel-build-'
        ? `for-parallel-build-${distinctCacheId('DB', '1')}`
        : distinctCacheId(prefix === 'worksheet-' ? 'Sheet1' : 'DB', '1');
    const name = prefix === 'workbook-for-parallel-build-' ? 'workbook' : prefix.slice(0, -1);
    symlinkSync(victim, join(state.cacheDir, `${name}-${id}.xml`));

    const output = await run();

    expect(readFileSync(victim, 'utf-8')).toBe('precious');
    expect(output).toMatch(/refused to write/);
  });
});
