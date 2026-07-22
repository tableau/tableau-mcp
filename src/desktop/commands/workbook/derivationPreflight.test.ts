/**
 * Apply-path integration coverage for the invalid-derivation-string preflight.
 *
 * These tests deliberately DO NOT mock the validation registry (unlike the sibling
 * loadWorkbookXml/loadWorksheetXml unit tests) so the real, registered rule set —
 * including invalid-derivation-string — runs. They prove the reject happens BEFORE
 * any Tableau call: the mock executor's applyWorkbookDocument is a spy asserted to be
 * unused when an invalid derivation is present.
 */
import { Ok } from 'ts-results-es';

import invariant from '../../../utils/invariant.js';
import * as xmlToJsonModule from '../../libraries/workbook-serialization-converter/index.js';
import { ToolExecutor } from '../../toolExecutor/toolExecutor.js';
import { loadWorkbookXml } from './loadWorkbookXml.js';
import { loadWorksheetXml } from './loadWorksheetXml.js';

vi.mock('fs');
vi.mock('../../libraries/workbook-serialization-converter/index.js');

const mockSignal = new AbortController().signal;

function workbookWithDerivation(derivation: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<workbook>
  <worksheets>
    <worksheet name="Sheet 1">
      <table>
        <view>
          <datasource-dependencies datasource="ds">
            <column-instance name="[${derivation}:Order Date:qk]" column="[Order Date]"
                             derivation="${derivation}" pivot="key" type="quantitative" />
          </datasource-dependencies>
        </view>
      </table>
    </worksheet>
  </worksheets>
  <windows>
    <window class="worksheet" name="Sheet 1"><cards /></window>
  </windows>
</workbook>`;
}

function worksheetWithDerivation(derivation: string): string {
  return `<worksheet name="Sheet 1">
  <table>
    <view>
      <datasource-dependencies datasource="ds">
        <column-instance name="[${derivation}:Order Date:qk]" column="[Order Date]"
                         derivation="${derivation}" pivot="key" type="quantitative" />
      </datasource-dependencies>
    </view>
  </table>
</worksheet>`;
}

describe('derivation preflight — apply-workbook path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects an invalid derivation before sending to Tableau', async () => {
    const applyWorkbookDocument = vi.fn();
    const mockExecutor = { applyWorkbookDocument } as unknown as ToolExecutor;

    const result = await loadWorkbookXml({
      xml: workbookWithDerivation('TruncMonth'),
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    invariant(result.isErr());
    invariant(result.error.type === 'load-workbook-xml-error');
    invariant(result.error.error.type === 'validation-failed');

    const issue = result.error.error.issues.find((i) => i.ruleId === 'invalid-derivation-string');
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe('error');
    expect(issue!.suggestion).toContain('Month-Trunc');

    // The reject is client-side: no document apply was ever sent to Tableau.
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('sends a canonical derivation through to Tableau (positive control)', async () => {
    vi.spyOn(xmlToJsonModule, 'xmlToJson').mockReturnValue('{"workbook": {}}');

    const applyWorkbookDocument = vi
      .fn()
      .mockResolvedValue(Ok({ command_id: 'cmd-1', status: 'completed', submitted_at: '' }));
    const mockExecutor = { applyWorkbookDocument } as unknown as ToolExecutor;

    const result = await loadWorkbookXml({
      xml: workbookWithDerivation('Month-Trunc'),
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    expect(applyWorkbookDocument).toHaveBeenCalled();
  });
});

describe('derivation preflight — apply-worksheet path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects an invalid derivation before sending to Tableau', async () => {
    const applyWorkbookDocument = vi.fn();
    const mockExecutor = { applyWorkbookDocument } as unknown as ToolExecutor;

    const result = await loadWorksheetXml({
      worksheetName: 'Sheet 1',
      xml: worksheetWithDerivation('TruncMonth'),
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    invariant(result.isErr());
    invariant(result.error.type === 'load-worksheet-xml-error');
    invariant(result.error.error.type === 'validation-failed');

    const issue = result.error.error.issues.find((i) => i.ruleId === 'invalid-derivation-string');
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe('error');
    expect(issue!.suggestion).toContain('Month-Trunc');

    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('sends a canonical derivation through to Tableau (positive control)', async () => {
    const applyWorkbookDocument = vi
      .fn()
      .mockResolvedValue(Ok({ command_id: 'cmd-2', status: 'completed', submitted_at: '' }));
    const mockExecutor = {
      executeCommand: vi.fn().mockResolvedValue(
        Ok({
          command_id: 'cmd-1',
          status: 'completed',
          submitted_at: '',
        }),
      ),
      getWorkbookDocument: vi.fn().mockResolvedValue(
        Ok({
          xml: workbookWithDerivation('Month-Trunc'),
          applicationVersion: undefined,
          xsdPayloadVersion: undefined,
        }),
      ),
      applyWorkbookDocument,
      listWorksheets: vi.fn().mockResolvedValue(
        Ok({
          worksheets: [{ id: 'sheet-1', name: 'Sheet 1' }],
        }),
      ),
      getWorksheetDocument: vi
        .fn()
        .mockResolvedValue(Ok({ xml: worksheetWithDerivation('Month-Trunc') })),
    } as unknown as ToolExecutor;

    const result = await loadWorksheetXml({
      worksheetName: 'Sheet 1',
      xml: worksheetWithDerivation('Month-Trunc'),
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    expect(applyWorkbookDocument).toHaveBeenCalled();
  });
});
