import { Err, Ok } from 'ts-results-es';

import { ExternalApiToolExecutor } from '../../externalApi/externalApiToolExecutor.js';
import { ExecuteCommandError } from '../../toolExecutor/toolExecutor.js';
import { listWorksheets } from './listWorksheets.js';

describe('listWorksheets', () => {
  it('uses the first-class worksheet list endpoint without fetching the workbook document', async () => {
    const signal = new AbortController().signal;
    const executor = {
      listWorksheets: vi.fn().mockResolvedValue(
        Ok({
          worksheets: [{ id: 'sheet-1', name: 'Sales & Profit' }],
        }),
      ),
      executeCommand: vi.fn(),
    } as unknown as ExternalApiToolExecutor;

    const result = await listWorksheets({ executor, signal });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({
      count: 1,
      worksheets: ['Sales & Profit'],
    });
    expect(executor.executeCommand).not.toHaveBeenCalled();
  });

  it('falls back to the External API whole-document read when the first-class route is missing', async () => {
    const signal = new AbortController().signal;
    const routeMissing = {
      type: 'command-failed',
      error: { code: 'not-found', message: 'No route matches /v0/workbook/worksheets' },
    } as ExecuteCommandError;
    const executor = {
      listWorksheets: vi.fn().mockResolvedValue(Err(routeMissing)),
      executeCommand: vi.fn().mockResolvedValue(
        Ok({
          parsedResult: {
            text: `<workbook><worksheets>
            <worksheet name="Sales &amp; Profit" />
            <worksheet name="Dashboard Source" />
          </worksheets></workbook>`,
          },
        }),
      ),
    } as unknown as ExternalApiToolExecutor;

    const result = await listWorksheets({ executor, signal });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({
      count: 2,
      worksheets: ['Sales & Profit', 'Dashboard Source'],
    });
    expect(executor.executeCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'save-underlying-metadata',
        namespace: 'tabui',
      }),
    );
  });
});
