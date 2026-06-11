import { Err, Ok } from 'ts-results-es';

import invariant from '../../../utils/invariant.js';
import { LocalExecutor } from '../../toolExecutor/localToolExecutor.js';
import { getWorksheetXml } from './getWorksheetXml.js';

vi.mock('../../toolExecutor/localToolExecutor.js');

describe('getWorksheetXml', () => {
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
