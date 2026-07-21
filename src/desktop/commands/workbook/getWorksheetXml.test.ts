import { Err, Ok } from 'ts-results-es';

import invariant from '../../../utils/invariant.js';
import { ExternalApiToolExecutor } from '../../externalApi/externalApiToolExecutor.js';
import {
  MockExternalApiServer,
  startMockExternalApiServer,
} from '../../externalApi/mockExternalApiServer.js';
import { ExternalApiInstance } from '../../externalApi/types.js';
import { LocalExecutor } from '../../toolExecutor/localToolExecutor.js';
import { getWorksheetXml, isRouteMissing } from './getWorksheetXml.js';

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

describe('getWorksheetXml (External Client API transport)', () => {
  const mockSignal = new AbortController().signal;
  let server: MockExternalApiServer;

  beforeEach(async () => {
    vi.clearAllMocks();
    server = await startMockExternalApiServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it('resolves worksheet name to id and fetches the per-item document', async () => {
    const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
    await executor.start();

    const result = await getWorksheetXml({
      worksheetName: 'Sales by Region',
      executor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toContain('<worksheet name="Sales by Region"');
    }

    expect(server.requests.map((request) => request.path)).toEqual([
      '/v0/workbook/worksheets',
      '/v0/workbook/worksheets/sheet-sales/document',
    ]);
    expect(server.requests.map((request) => request.path)).not.toContain('/v0/workbook/document');
  });

  it('accepts worksheet id directly before name matching', async () => {
    const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
    await executor.start();

    const result = await getWorksheetXml({
      worksheetName: 'sheet-sales',
      executor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    expect(server.requests.at(-1)?.path).toBe('/v0/workbook/worksheets/sheet-sales/document');
  });

  it('returns no-worksheet-found when the first-class list has no matching worksheet', async () => {
    const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
    await executor.start();

    const result = await getWorksheetXml({
      worksheetName: 'Missing Sheet',
      executor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'get-worksheet-xml-error');
      expect(result.error.error.type).toBe('no-worksheet-found');
      expect(result.error.error.message).toContain('Missing Sheet');
    }
  });

  it('preserves route-missing errors for older Desktop builds', async () => {
    server.setOverride('GET /v0/workbook/worksheets/sheet-sales/document', {
      status: 404,
      body: JSON.stringify({
        code: 'not-found',
        status: 404,
        instance: '/v0/mock',
        title: 'No route matches GET /v0/workbook/worksheets/sheet-sales/document',
        detail: 'No route matches GET /v0/workbook/worksheets/sheet-sales/document',
      }),
    });
    const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
    await executor.start();

    const result = await getWorksheetXml({
      worksheetName: 'Sales by Region',
      executor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'execute-command-error');
      expect(isRouteMissing(result.error.error)).toBe(true);
    }
  });
});

const instanceFor = (server: MockExternalApiServer): ExternalApiInstance => ({
  baseUrl: server.baseUrl,
  token: 'valid-token',
  pid: 999,
  instanceId: 'inst-worksheet',
  apiVersion: '1.0',
});
