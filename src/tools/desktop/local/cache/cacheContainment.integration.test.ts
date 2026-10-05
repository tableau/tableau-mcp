import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { DesktopMcpServer } from '../../../../server.desktop.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { getReadCachedXmlTool } from './readCachedXml.js';
import { getWriteCachedXmlTool } from './writeCachedXml.js';

const state = vi.hoisted(() => ({ cacheDir: '' }));

vi.mock('../../../../desktop/cache.js', () => ({
  DesktopCache: class {
    getCacheFilePath({ prefix, id }: { prefix: string; id?: string }): string {
      return join(state.cacheDir, `${prefix}-${id ?? 'default'}.xml`);
    }
  },
}));
vi.mock('../../../../desktop/session/sessionResolution.js', () => ({
  resolveSession: (session: string) => ({ isErr: () => false, value: session }),
}));
vi.mock('../../../../desktop/wrappers/cacheFingerprint.js', () => ({
  restampSidecarAfterEdit: vi.fn(),
}));

describe('cached XML callback containment', () => {
  let root: string;
  let outsideDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cached-xml-callback-'));
    state.cacheDir = join(root, 'cache');
    outsideDir = join(root, 'outside');
    mkdirSync(state.cacheDir);
    mkdirSync(outsideDir);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('reads and updates an ordinary cache file', async () => {
    const file = join(state.cacheDir, 'ordinary.xml');
    writeFileSync(file, '<workbook><worksheets/></workbook>');

    const readResult = await invokeRead(file);
    expect(readResult.isError).toBeFalsy();
    expect(text(readResult)).toContain('<worksheets/>');

    const writeResult = await invokeWrite(file, '<workbook><dashboards/></workbook>');
    expect(writeResult.isError).toBeFalsy();
    expect(readFileSync(file, 'utf-8')).toBe('<workbook><dashboards/></workbook>');
  });

  it('creates a missing direct cache child', async () => {
    const file = join(state.cacheDir, 'new.xml');

    const result = await invokeWrite(file, '<workbook/>');

    expect(result.isError).toBeFalsy();
    expect(readFileSync(file, 'utf-8')).toBe('<workbook/>');
  });

  it('updates an existing nested file but rejects nested creation with a clear error', async () => {
    const nestedDir = join(state.cacheDir, 'nested');
    const existing = join(nestedDir, 'existing.xml');
    const missing = join(nestedDir, 'missing.xml');
    mkdirSync(nestedDir);
    writeFileSync(existing, '<workbook><before/></workbook>');

    const existingResult = await invokeWrite(existing, '<workbook><after/></workbook>');
    expect(existingResult.isError).toBeFalsy();
    expect(readFileSync(existing, 'utf-8')).toBe('<workbook><after/></workbook>');

    const missingResult = await invokeWrite(missing, '<workbook/>');
    expect(missingResult.isError).toBe(true);
    expect(text(missingResult)).toContain('new cache files must be direct children');
    expect(() => readFileSync(missing)).toThrow();
  });

  it.each(['final', 'intermediate'] as const)(
    'rejects %s-component symlink reads and writes without changing the external target',
    async (linkKind) => {
      const external = join(outsideDir, 'external.xml');
      const original = '<workbook><outside/></workbook>';
      writeFileSync(external, original);
      let candidate: string;
      if (linkKind === 'final') {
        candidate = join(state.cacheDir, 'linked.xml');
        symlinkSync(external, candidate, 'file');
      } else {
        symlinkSync(outsideDir, join(state.cacheDir, 'linked'), directoryLinkType());
        candidate = join(state.cacheDir, 'linked', 'external.xml');
      }

      const readResult = await invokeRead(candidate);
      expect(readResult.isError).toBe(true);
      expect(text(readResult)).toContain('Security error');

      const writeResult = await invokeWrite(candidate, '<workbook><escaped/></workbook>');
      expect(writeResult.isError).toBe(true);
      expect(text(writeResult)).toContain('Security error');

      const spliceResult = await invokeWrite(
        candidate,
        "<worksheet name='Sales'><rows>[escaped]</rows></worksheet>",
        { worksheet: 'Sales' },
      );
      expect(spliceResult.isError).toBe(true);
      expect(text(spliceResult)).toContain('Security error');
      expect(readFileSync(external, 'utf-8')).toBe(original);
    },
  );

  it('uses a contained read for worksheet splices and preserves sibling XML', async () => {
    const file = join(state.cacheDir, 'workbook.xml');
    writeFileSync(
      file,
      '<workbook><worksheets>' +
        "<worksheet name='Sales'><rows>[old]</rows></worksheet>" +
        "<worksheet name='Profit'><rows>[keep]</rows></worksheet>" +
        '</worksheets></workbook>',
    );

    const readResult = await invokeRead(file, { worksheet: 'Sales' });
    expect(readResult.isError).toBeFalsy();
    expect(text(readResult)).toContain('[old]');
    expect(text(readResult)).not.toContain('[keep]');

    const writeResult = await invokeWrite(
      file,
      "<worksheet name='Sales'><rows>[new]</rows></worksheet>",
      { worksheet: 'Sales' },
    );
    expect(writeResult.isError).toBeFalsy();
    expect(readFileSync(file, 'utf-8')).toContain('[new]');
    expect(readFileSync(file, 'utf-8')).toContain('[keep]');
  });
});

async function invokeRead(
  filePath: string,
  selectors: { worksheet?: string; dashboard?: string } = {},
): Promise<CallToolResult> {
  const callback = await Provider.from(getReadCachedXmlTool(new DesktopMcpServer()).callback);
  return callback(
    {
      filePath,
      worksheetName: undefined,
      worksheet: selectors.worksheet,
      dashboardName: undefined,
      dashboard: selectors.dashboard,
      startByte: undefined,
      endByte: undefined,
    },
    getMockRequestHandlerExtra(),
  );
}

async function invokeWrite(
  filePath: string,
  xmlContent: string,
  selectors: { worksheet?: string; dashboard?: string } = {},
): Promise<CallToolResult> {
  const callback = await Provider.from(getWriteCachedXmlTool(new DesktopMcpServer()).callback);
  return callback(
    {
      session: '12345',
      filePath,
      xmlContent,
      worksheetName: undefined,
      worksheet: selectors.worksheet,
      dashboardName: undefined,
      dashboard: selectors.dashboard,
    },
    getMockRequestHandlerExtra(),
  );
}

function text(result: CallToolResult): string {
  invariant(result.content[0].type === 'text');
  return result.content[0].text;
}

function directoryLinkType(): 'dir' | 'junction' {
  return process.platform === 'win32' ? 'junction' : 'dir';
}
