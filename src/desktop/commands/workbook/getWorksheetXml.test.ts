import { Err, Ok } from 'ts-results-es';

import * as configModule from '../../../config.desktop.js';
import invariant from '../../../utils/invariant.js';
import { LocalExecutor } from '../../toolExecutor/localToolExecutor.js';
import { getWorksheetXml } from './getWorksheetXml.js';

vi.mock('../../toolExecutor/localToolExecutor.js');

describe('getWorksheetXml (Agent API transport, default)', () => {
  const mockSignal = new AbortController().signal;
  const worksheetName = 'Sheet 1';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should successfully return worksheet XML', async () => {
    const mockXml = '<worksheet name="Sheet 1"><table></table></worksheet>';
    const mockExecutor = {
      executeCommand: vi.fn().mockResolvedValue(
        Ok({
          command_id: 'cmd-123',
          status: 'completed',
          parsedResult: {
            worksheetXml: mockXml,
          },
        }),
      ),
    } as unknown as LocalExecutor;

    const result = await getWorksheetXml({
      worksheetName,
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe(mockXml);
    }

    expect(mockExecutor.executeCommand).toHaveBeenCalledWith({
      namespace: 'tabui',
      command: 'save-worksheet',
      args: { worksheetName },
      schema: expect.any(Object),
      signal: mockSignal,
    });
  });

  it('should return error when executeCommand fails', async () => {
    const error = {
      type: 'command-failed' as const,
      error: { code: 'ERROR', message: 'Worksheet not found' },
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

  it('should return no-worksheet-found error when response contains no worksheet element', async () => {
    const mockExecutor = {
      executeCommand: vi.fn().mockResolvedValue(
        Ok({
          command_id: 'cmd-123',
          status: 'completed',
          parsedResult: {
            worksheetXml: '<empty></empty>',
          },
        }),
      ),
    } as unknown as LocalExecutor;

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

  it('appends a "did you mean" suggestion listing close sheet names on a miss (W6)', async () => {
    // save-worksheet finds nothing; list-worksheets returns the real names so the
    // miss message can surface close matches for self-correction.
    const mockExecutor = {
      executeCommand: vi.fn(async (params: any) => {
        if (params.command === 'list-worksheets') {
          return Ok({
            command_id: 'cmd-list',
            status: 'completed',
            parsedResult: {
              worksheets: JSON.stringify({
                count: 3,
                worksheets: [{ name: 'Sales by Region' }, { name: 'Profit Map' }, { name: 'KPIs' }],
              }),
            },
          });
        }
        return Ok({
          command_id: 'cmd-123',
          status: 'completed',
          parsedResult: { worksheetXml: '<empty></empty>' },
        });
      }),
    } as unknown as LocalExecutor;

    const result = await getWorksheetXml({
      worksheetName: 'Sales',
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'get-worksheet-xml-error');
      expect(result.error.error.type).toBe('no-worksheet-found');
      // "Sales" is a substring of "Sales by Region" → surfaced as a close match.
      expect(result.error.error.message).toContain('Did you mean');
      expect(result.error.error.message).toContain('"Sales by Region"');
      expect(result.error.error.message).toContain('ask the user instead of guessing');
      // A non-matching sheet is not listed among the close matches.
      expect(result.error.error.message).not.toContain('"KPIs"');
    }
  });

  it('should return multiple-worksheets-found error when response contains more than one worksheet', async () => {
    const mockXml = '<workbook><worksheet name="Sheet 1"/><worksheet name="Sheet 2"/></workbook>';
    const mockExecutor = {
      executeCommand: vi.fn().mockResolvedValue(
        Ok({
          command_id: 'cmd-123',
          status: 'completed',
          parsedResult: {
            worksheetXml: mockXml,
          },
        }),
      ),
    } as unknown as LocalExecutor;

    const result = await getWorksheetXml({
      worksheetName,
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'get-worksheet-xml-error');
      expect(result.error.error.type).toBe('multiple-worksheets-found');
      expect(result.error.error.message).toContain('2');
    }
  });

  it('should pass worksheetName as arg to save-worksheet command', async () => {
    const mockExecutor = {
      executeCommand: vi.fn().mockResolvedValue(
        Ok({
          command_id: 'cmd-123',
          status: 'completed',
          parsedResult: {
            worksheetXml: '<worksheet name="My Sheet"/>',
          },
        }),
      ),
    } as unknown as LocalExecutor;

    await getWorksheetXml({
      worksheetName: 'My Sheet',
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(mockExecutor.executeCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        args: { worksheetName: 'My Sheet' },
      }),
    );
  });

  it('should handle XML with special characters', async () => {
    const mockXml = '<worksheet name="Sales &amp; Data"><formula>&lt;SUM&gt;</formula></worksheet>';
    const mockExecutor = {
      executeCommand: vi.fn().mockResolvedValue(
        Ok({
          command_id: 'cmd-123',
          status: 'completed',
          parsedResult: {
            worksheetXml: mockXml,
          },
        }),
      ),
    } as unknown as LocalExecutor;

    const result = await getWorksheetXml({
      worksheetName,
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toContain('&amp;');
    }
  });

  it('falls back to the raw escaped Desktop command name for a literal ampersand name', async () => {
    const mockXml =
      '<worksheet name="P&amp;L Waterfall: Revenue to Net Income"><table></table></worksheet>';
    const mockExecutor = {
      executeCommand: vi.fn(async (params: any) => {
        if (params.command === 'list-worksheets') {
          return Ok({
            command_id: 'cmd-list',
            status: 'completed',
            parsedResult: {
              worksheets: JSON.stringify({
                count: 1,
                worksheets: [{ name: 'P&amp;L Waterfall: Revenue to Net Income' }],
              }),
            },
          });
        }
        return Ok({
          command_id: 'cmd-123',
          status: 'completed',
          parsedResult: {
            worksheetXml:
              params.args.worksheetName === 'P&amp;L Waterfall: Revenue to Net Income'
                ? mockXml
                : '<empty></empty>',
          },
        });
      }),
    } as unknown as LocalExecutor;

    const result = await getWorksheetXml({
      worksheetName: 'P&L Waterfall: Revenue to Net Income',
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe(mockXml);
    }
    expect(mockExecutor.executeCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'save-worksheet',
        args: { worksheetName: 'P&L Waterfall: Revenue to Net Income' },
      }),
    );
    expect(mockExecutor.executeCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'save-worksheet',
        args: { worksheetName: 'P&amp;L Waterfall: Revenue to Net Income' },
      }),
    );
  });
});

describe('getWorksheetXml (External Client API transport, TABLEAU_EXTERNAL_API gate)', () => {
  const mockSignal = new AbortController().signal;
  const worksheetName = 'Sheet 1';

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

  beforeEach(() => {
    vi.clearAllMocks();
    const base = configModule.getDesktopConfig();
    vi.spyOn(configModule, 'getDesktopConfig').mockReturnValue({
      ...base,
      externalApiEnabled: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

  it('matches escaped worksheetName input against decoded workbook XML names', async () => {
    const mockExecutor = executorReturning(
      workbookWith(['P&amp;L Waterfall: Revenue to Net Income', 'Revenue &lt; &quot;Gross&quot;']),
    );

    const ampResult = await getWorksheetXml({
      worksheetName: 'P&amp;L Waterfall: Revenue to Net Income',
      executor: mockExecutor,
      signal: mockSignal,
    });
    const angleQuoteResult = await getWorksheetXml({
      worksheetName: 'Revenue < "Gross"',
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(ampResult.isOk()).toBe(true);
    if (ampResult.isOk()) {
      expect(ampResult.value).toContain('P&amp;L Waterfall: Revenue to Net Income');
    }
    expect(angleQuoteResult.isOk()).toBe(true);
    if (angleQuoteResult.isOk()) {
      expect(angleQuoteResult.value).toContain('Revenue &lt; &quot;Gross&quot;');
    }
  });
});
