import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import * as cacheFingerprintModule from '../../../desktop/commands/workbook/cacheFingerprint.js';
import * as discoveryModule from '../../../desktop/externalApi/discovery.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getAddFieldTool } from './addField.js';

// Real fs and real metadata here on purpose: the sibling suite mocks both, so it
// cannot show what add-field writes into a worksheet for a field it could not find.
vi.mock('../../../desktop/commands/workbook/cacheFingerprint.js');
vi.mock('../../../desktop/externalApi/discovery.js');

const SESSION = '12345';

// [Order Date] lives only in a nested relation — no <column> element, two joins
// deep. [Profit] carries an explicit <column> and is the control.
const WORKBOOK = `<?xml version='1.0' encoding='utf-8' ?>
<workbook version='18.1'>
  <datasources>
    <datasource name='Sample - Superstore' caption='Sample - Superstore'>
      <connection class='federated'>
        <relation type='join' name='outer'>
          <relation type='join' name='inner'>
            <relation type='table' name='Orders'>
              <columns><column name='Order Date' datatype='date' /></columns>
            </relation>
          </relation>
        </relation>
      </connection>
      <column name='[Profit]' role='measure' type='quantitative' datatype='real' />
    </datasource>
  </datasources>
</workbook>`;

const WORKSHEET = `<?xml version='1.0' encoding='utf-8' ?>
<worksheet name='Sheet 1'>
  <table>
    <view>
      <datasources><datasource name='Sample - Superstore' /></datasources>
      <datasource-dependencies datasource='Sample - Superstore' />
    </view>
    <rows />
    <cols />
  </table>
</worksheet>`;

const dirs: string[] = [];

function setup(): { workbookFile: string; worksheetFile: string } {
  const dir = mkdtempSync(join(tmpdir(), 'tmcp-add-field-'));
  dirs.push(dir);
  const workbookFile = join(dir, 'workbook.xml');
  const worksheetFile = join(dir, 'worksheet.xml');
  writeFileSync(workbookFile, WORKBOOK, 'utf-8');
  writeFileSync(worksheetFile, WORKSHEET, 'utf-8');
  return { workbookFile, worksheetFile };
}

async function addField(params: {
  worksheetFile: string;
  workbookFile: string;
  target: 'rows' | 'cols';
  columnRef: string;
}): Promise<CallToolResult> {
  const tool = getAddFieldTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(
    {
      session: SESSION,
      worksheetName: undefined,
      encodingType: undefined,
      index: undefined,
      ...params,
    },
    getMockRequestHandlerExtra(),
  );
}

describe('add-field — an absent column comes back as a tool error, not a crash', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(discoveryModule.discoverInstances).mockReturnValue([]);
  });

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('returns isError with the recovery text and leaves the server usable', async () => {
    const { workbookFile, worksheetFile } = setup();

    const failure = await addField({
      worksheetFile,
      workbookFile,
      target: 'cols',
      columnRef: '[Sample - Superstore].[sum:Nonexistent Field:qk]',
    });

    expect(failure.isError).toBe(true);
    invariant(failure.content[0].type === 'text');
    expect(failure.content[0].text).toContain('does not exist in datasource "Sample - Superstore"');
    expect(failure.content[0].text).toContain('resolve-field');
    expect(failure.content[0].text).toContain('bind-template');
    expect(failure.content[0].text).not.toContain('list-available-fields');
    // Still tells the agent how to beat a stale cache, but via a tool the served
    // profile actually has. Naming an off-profile tool here is a dead end — the
    // model cannot call it, so its retry cannot differ. See
    // src/desktop/recoveryTextNamesReachableTools.test.ts for the general rule.
    expect(failure.content[0].text).toContain('stale cache');
    expect(failure.content[0].text).not.toContain('get-workbook-xml');
    // The refusal must not have written a half-built worksheet.
    expect(readFileSync(worksheetFile, 'utf-8')).toBe(WORKSHEET);

    // Same tool, straight after the refusal: it still works.
    const success = await addField({
      worksheetFile,
      workbookFile,
      target: 'cols',
      columnRef: '[Sample - Superstore].[sum:Profit:qk]',
    });

    expect(success.isError).toBe(false);
    expect(readFileSync(worksheetFile, 'utf-8')).toContain('[sum:Profit:qk]');
    expect(cacheFingerprintModule.writeSidecar).toHaveBeenCalledWith(worksheetFile, SESSION);
  });

  it('resolves a field that lives only in a nested relation, through the tool', async () => {
    const { workbookFile, worksheetFile } = setup();

    const result = await addField({
      worksheetFile,
      workbookFile,
      target: 'rows',
      columnRef: '[Sample - Superstore].[none:Order Date:qk]',
    });

    expect(result.isError).toBe(false);
    expect(readFileSync(worksheetFile, 'utf-8')).toContain('datatype="date"');
  });
});
