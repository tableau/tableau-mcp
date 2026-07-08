/**
 * Apply-path integration coverage for the invalid-derivation-string preflight.
 *
 * These tests deliberately DO NOT mock the validation registry (unlike the sibling
 * loadWorkbookXml/loadWorksheetXml unit tests) so the real, registered rule set —
 * including invalid-derivation-string — runs. They prove the reject happens BEFORE
 * any Tableau call: the mock executor's executeCommand is a spy asserted to be
 * unused when an invalid derivation is present.
 */
import { Ok } from 'ts-results-es';

import invariant from '../../../utils/invariant.js';
import { LocalExecutor } from '../../toolExecutor/localToolExecutor.js';
import { loadWorkbookXml } from './loadWorkbookXml.js';
import { loadWorksheetXml } from './loadWorksheetXml.js';

const mockSignal = new AbortController().signal;

// Executor that serves the live workbook on the save-underlying-metadata fetch and acks
// every other command, so the multi-call apply-worksheet flow (fetch → delete → apply) runs.
function dispatchingExecutor(workbookXml: string): LocalExecutor {
  const executeCommand = vi.fn(async (params: any) => {
    if (params.command === 'save-underlying-metadata') {
      return Ok({
        command_id: 'cmd-get',
        status: 'completed',
        parsedResult: { text: workbookXml },
      });
    }
    return Ok({ command_id: 'cmd-ok', status: 'completed', submitted_at: '' });
  });
  return { executeCommand } as unknown as LocalExecutor;
}

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
    const executeCommand = vi.fn();
    const mockExecutor = { executeCommand } as unknown as LocalExecutor;

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

    // The reject is client-side: no command was ever dispatched to Tableau.
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it('sends a canonical derivation through to Tableau (positive control)', async () => {
    const executor = dispatchingExecutor(workbookWithDerivation('Month-Trunc'));

    const result = await loadWorkbookXml({
      xml: workbookWithDerivation('Month-Trunc'),
      executor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    expect(executor.executeCommand).toHaveBeenCalled();
  });
});

describe('derivation preflight — apply-worksheet path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects an invalid derivation before sending to Tableau', async () => {
    const executeCommand = vi.fn();
    const mockExecutor = { executeCommand } as unknown as LocalExecutor;

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

    expect(executeCommand).not.toHaveBeenCalled();
  });

  it('sends a canonical derivation through to Tableau (positive control)', async () => {
    const executor = dispatchingExecutor(workbookWithDerivation('Month-Trunc'));

    const result = await loadWorksheetXml({
      worksheetName: 'Sheet 1',
      xml: worksheetWithDerivation('Month-Trunc'),
      executor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    expect(executor.executeCommand).toHaveBeenCalled();
  });
});
