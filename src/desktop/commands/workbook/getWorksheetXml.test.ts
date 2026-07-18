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
});

describe('getWorksheetXml (External Client API transport, TABLEAU_EXTERNAL_API gate)', () => {
  const mockSignal = new AbortController().signal;
  const worksheetName = 'Sheet 1';

  // Serves the typed reads the external branch issues: list-worksheets (name→id resolve, also
  // used by the did-you-mean miss path) and get-worksheet-document (returns the sheet's XML).
  function executorFor(
    worksheets: Array<{ id: string; name: string }>,
    documentById: Record<string, string> = {},
  ): LocalExecutor {
    return {
      executeCommand: vi.fn().mockImplementation((params) => {
        if (params.command === 'list-worksheets') {
          return Promise.resolve(
            Ok({ command_id: 'cmd-1', status: 'completed', parsedResult: { worksheets } }),
          );
        }
        if (params.command === 'get-worksheet-document') {
          return Promise.resolve(
            Ok({
              command_id: 'cmd-2',
              status: 'completed',
              parsedResult: { text: documentById[params.args.id] ?? '' },
            }),
          );
        }
        return Promise.resolve(Err({ type: 'command-failed', error: { code: 'x', message: 'x' } }));
      }),
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

  it('should resolve the name to an id and return the worksheet document', async () => {
    const mockExecutor = executorFor(
      [
        { id: 'w1', name: 'Sheet 1' },
        { id: 'w2', name: 'Sheet 2' },
      ],
      { w1: '<worksheet name="Sheet 1"><table /></worksheet>' },
    );

    const result = await getWorksheetXml({
      worksheetName,
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toContain('name="Sheet 1"');
    }

    expect(mockExecutor.executeCommand).toHaveBeenCalledWith({
      namespace: 'tabui',
      command: 'get-worksheet-document',
      args: { id: 'w1' },
      schema: expect.any(Object),
      signal: mockSignal,
    });
  });

  it('should return execute-command-error when the list command fails', async () => {
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

  it('should return no-worksheet-found when no worksheet matches the name', async () => {
    const mockExecutor = executorFor([{ id: 'w9', name: 'Some Other Sheet' }]);

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

  it('should match a worksheet name with special characters', async () => {
    const mockExecutor = executorFor([{ id: 'w1', name: 'Sales & Data' }], {
      w1: '<worksheet name="Sales &amp; Data"><table /></worksheet>',
    });

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
