import { Err, Ok } from 'ts-results-es';

import invariant from '../../../utils/invariant.js';
import { LocalExecutor } from '../../toolExecutor/localToolExecutor.js';
import { getWorksheetXml } from './getWorksheetXml.js';

vi.mock('../../toolExecutor/localToolExecutor.js');

function workbookWith(worksheetNames: string[]): string {
  const worksheets = worksheetNames
    .map((name) => `<worksheet name='${name}'><table><rows /></table></worksheet>`)
    .join('');
  return `<?xml version='1.0'?><workbook><worksheets>${worksheets}</worksheets></workbook>`;
}

function executorReturning(text: string): LocalExecutor {
  return {
    executeCommand: vi.fn().mockResolvedValue(
      Ok({
        command_id: 'cmd-123',
        status: 'completed',
        parsedResult: { text },
      }),
    ),
  } as unknown as LocalExecutor;
}

describe('getWorksheetXml', () => {
  const mockSignal = new AbortController().signal;
  const worksheetName = 'Sheet 1';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should slice the requested worksheet out of the whole-workbook document', async () => {
    const mockExecutor = executorReturning(workbookWith(['Sheet 1', 'Sheet 2']));

    const result = await getWorksheetXml({
      worksheetName,
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toContain('<worksheet');
      expect(result.value).toContain('name="Sheet 1"');
      expect(result.value).not.toContain('Sheet 2');
    }

    expect(mockExecutor.executeCommand).toHaveBeenCalledWith({
      namespace: 'tabui',
      command: 'save-underlying-metadata',
      args: { 'is-json': false },
      schema: expect.any(Object),
      signal: mockSignal,
    });
  });

  it('should return execute-command-error when the workbook fetch fails', async () => {
    const error = {
      type: 'command-failed' as const,
      error: { code: 'ERROR', message: 'Fetch failed' },
    };
    const mockExecutor = {
      executeCommand: vi.fn().mockResolvedValue(Err(error)),
    } as unknown as LocalExecutor;

    const result = await getWorksheetXml({
      worksheetName,
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'execute-command-error');
      expect(result.error.error).toEqual(error);
    }
  });

  it('should return no-worksheet-found when the workbook has no matching worksheet', async () => {
    const mockExecutor = executorReturning(workbookWith(['Some Other Sheet']));

    const result = await getWorksheetXml({
      worksheetName,
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'get-worksheet-xml-error');
      expect(result.error.error.type).toBe('no-worksheet-found');
      expect(result.error.error.message).toContain(worksheetName);
    }
  });

  it('should handle worksheet names with special characters', async () => {
    const mockExecutor = executorReturning(workbookWith(['Sales &amp; Data']));

    const result = await getWorksheetXml({
      worksheetName: 'Sales & Data',
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toContain('Sales &amp; Data');
    }
  });
});
