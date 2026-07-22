import { Err, Ok } from 'ts-results-es';

import { ExternalApiToolExecutor } from '../../externalApi/externalApiToolExecutor.js';
import { ExecuteCommandError } from '../../toolExecutor/toolExecutor.js';
import { getWorksheetFragment, getWorksheetXml } from './getWorksheetXml.js';

describe('getWorksheetXml', () => {
  it('resolves worksheet name to id and fetches the per-item document', async () => {
    const signal = new AbortController().signal;
    const executor = {
      listWorksheets: vi.fn().mockResolvedValue(
        Ok({
          worksheets: [
            { id: 'sheet-1', name: 'Sales' },
            { id: 'sheet-2', name: 'Profit' },
          ],
        }),
      ),
      getWorksheetDocument: vi.fn().mockResolvedValue(Ok({ xml: '<worksheet name="Profit" />' })),
      executeCommand: vi.fn(),
    } as unknown as ExternalApiToolExecutor;

    const result = await getWorksheetXml({
      executor,
      signal,
      worksheetName: 'Profit',
    });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBe('<worksheet name="Profit" />');
    expect(executor.getWorksheetDocument).toHaveBeenCalledWith('sheet-2', expect.any(AbortSignal));
    expect(executor.executeCommand).not.toHaveBeenCalled();
  });

  it('accepts worksheet id directly before name matching', async () => {
    const signal = new AbortController().signal;
    const executor = {
      listWorksheets: vi.fn().mockResolvedValue(
        Ok({
          worksheets: [{ id: 'sheet-1', name: 'Sales' }],
        }),
      ),
      getWorksheetDocument: vi.fn().mockResolvedValue(Ok({ xml: '<worksheet name="Sales" />' })),
    } as unknown as ExternalApiToolExecutor;

    const result = await getWorksheetXml({
      executor,
      signal,
      worksheetName: 'sheet-1',
    });

    expect(result.isOk()).toBe(true);
    expect(executor.getWorksheetDocument).toHaveBeenCalledWith('sheet-1', expect.any(AbortSignal));
  });

  it('returns no-worksheet-found when the first-class list has no matching worksheet', async () => {
    const signal = new AbortController().signal;
    const executor = {
      listWorksheets: vi.fn().mockResolvedValue(
        Ok({
          worksheets: [{ id: 'sheet-1', name: 'Sales' }],
        }),
      ),
      getWorksheetDocument: vi.fn(),
    } as unknown as ExternalApiToolExecutor;

    const result = await getWorksheetXml({
      executor,
      signal,
      worksheetName: 'Profit',
    });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toEqual({
      type: 'get-worksheet-xml-error',
      error: {
        type: 'no-worksheet-found',
        message: 'Worksheet "Profit" was not found. Available worksheets: Sales (sheet-1)',
      },
    });
    expect(executor.getWorksheetDocument).not.toHaveBeenCalled();
  });

  it('falls back to the External API whole-document read when the first-class route is missing', async () => {
    const signal = new AbortController().signal;
    const routeMissing = {
      type: 'command-failed',
      error: { code: 'not-found', message: 'No route matches /v0/workbook/worksheets' },
    } as ExecuteCommandError;
    const executor = {
      listWorksheets: vi.fn().mockResolvedValue(Err(routeMissing)),
      getWorkbookDocument: vi.fn().mockResolvedValue(
        Ok({
          xml: `<workbook><worksheets>
            <worksheet name="Profit"><table><view /></table></worksheet>
          </worksheets></workbook>`,
          applicationVersion: undefined,
          xsdPayloadVersion: undefined,
        }),
      ),
    } as unknown as ExternalApiToolExecutor;

    const result = await getWorksheetXml({
      executor,
      signal,
      worksheetName: 'Profit',
    });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toContain('<worksheet name="Profit">');
    expect(executor.getWorkbookDocument).toHaveBeenCalledWith(signal);
  });
});

describe('getWorksheetFragment', () => {
  it('slices the requested sheet out of a whole-workbook /document response', async () => {
    const signal = new AbortController().signal;
    const executor = {
      listWorksheets: vi.fn().mockResolvedValue(
        Ok({
          worksheets: [
            { id: 'sheet-1', name: 'Sales by Region' },
            { id: 'sheet-2', name: 'Profit by Category' },
          ],
        }),
      ),
      getWorksheetDocument: vi.fn().mockResolvedValue(
        Ok({
          xml: `<workbook><worksheets>
            <worksheet name="Sales by Region"><table><view /></table></worksheet>
            <worksheet name="Profit by Category"><table><view /></table></worksheet>
          </worksheets></workbook>`,
        }),
      ),
    } as unknown as ExternalApiToolExecutor;

    const result = await getWorksheetFragment({
      executor,
      signal,
      worksheetName: 'Sales by Region',
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toContain('<worksheet name="Sales by Region"');
      expect(result.value).not.toContain('<workbook');
      expect(result.value).not.toContain('Profit by Category');
    }
  });

  it('returns a bare worksheet fragment unchanged', async () => {
    const signal = new AbortController().signal;
    const executor = {
      listWorksheets: vi.fn().mockResolvedValue(
        Ok({
          worksheets: [{ id: 'sheet-1', name: 'Sales' }],
        }),
      ),
      getWorksheetDocument: vi.fn().mockResolvedValue(Ok({ xml: '<worksheet name="Sales" />' })),
    } as unknown as ExternalApiToolExecutor;

    const result = await getWorksheetFragment({
      executor,
      signal,
      worksheetName: 'Sales',
    });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBe('<worksheet name="Sales" />');
  });
});
