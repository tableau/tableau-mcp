import { Err, Ok } from 'ts-results-es';

import { LocalExecutor } from '../../toolExecutor/localToolExecutor.js';
import { getWorkbookXml } from './getWorkbookXml.js';

vi.mock('../../toolExecutor/localToolExecutor.js');

describe('getWorkbookXml', () => {
  const mockSignal = new AbortController().signal;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should successfully return workbook XML', async () => {
    const mockXml = '<?xml version="1.0"?><workbook><worksheets></worksheets></workbook>';
    const mockExecutor = {
      executeCommand: vi.fn().mockResolvedValue(
        Ok({
          command_id: 'cmd-123',
          status: 'completed',
          parsedResult: {
            text: mockXml,
          },
        }),
      ),
    } as unknown as LocalExecutor;

    const result = await getWorkbookXml({ executor: mockExecutor, signal: mockSignal });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe(mockXml);
    }

    expect(mockExecutor.executeCommand).toHaveBeenCalledWith({
      namespace: 'tabui',
      command: 'save-underlying-metadata',
      args: {
        'is-json': false,
      },
      schema: expect.any(Object),
      signal: mockSignal,
    });
  });

  it('should return large workbook XML', async () => {
    const largeXml = '<?xml version="1.0"?><workbook>' + '<worksheet>'.repeat(1000) + '</workbook>';
    const mockExecutor = {
      executeCommand: vi.fn().mockResolvedValue(
        Ok({
          command_id: 'cmd-123',
          status: 'completed',
          parsedResult: {
            text: largeXml,
          },
        }),
      ),
    } as unknown as LocalExecutor;

    const result = await getWorkbookXml({ executor: mockExecutor, signal: mockSignal });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe(largeXml);
      expect(result.value.length).toBeGreaterThan(10000);
    }
  });

  it('should return error when executeCommand fails', async () => {
    const error = { type: 'command-failed' as const, error: { code: 'ERROR', message: 'Failed' } };
    const mockExecutor = {
      executeCommand: vi.fn().mockResolvedValue(Err(error)),
    } as unknown as LocalExecutor;

    const result = await getWorkbookXml({ executor: mockExecutor, signal: mockSignal });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toEqual(error);
    }
  });

  it('should handle empty XML text', async () => {
    const mockExecutor = {
      executeCommand: vi.fn().mockResolvedValue(
        Ok({
          command_id: 'cmd-123',
          status: 'completed',
          parsedResult: {
            text: '',
          },
        }),
      ),
    } as unknown as LocalExecutor;

    const result = await getWorkbookXml({ executor: mockExecutor, signal: mockSignal });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe('');
    }
  });

  it('should handle XML with special characters', async () => {
    const mockXml = `<?xml version="1.0" encoding="UTF-8"?>
<workbook>
  <worksheet name="Sheet &amp; Data">
    <formula>&lt;![CDATA[SUM([Sales])]]&gt;</formula>
  </worksheet>
</workbook>`;
    const mockExecutor = {
      executeCommand: vi.fn().mockResolvedValue(
        Ok({
          command_id: 'cmd-123',
          status: 'completed',
          parsedResult: {
            text: mockXml,
          },
        }),
      ),
    } as unknown as LocalExecutor;

    const result = await getWorkbookXml({ executor: mockExecutor, signal: mockSignal });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toContain('&amp;');
      expect(result.value).toContain('&lt;');
      expect(result.value).toContain('&gt;');
    }
  });

  it('should pass correct arguments to save-underlying-metadata command', async () => {
    const mockExecutor = {
      executeCommand: vi.fn().mockResolvedValue(
        Ok({
          command_id: 'cmd-123',
          status: 'completed',
          parsedResult: {
            text: '<workbook></workbook>',
          },
        }),
      ),
    } as unknown as LocalExecutor;

    await getWorkbookXml({ executor: mockExecutor, signal: mockSignal });

    expect(mockExecutor.executeCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        args: { 'is-json': false },
      }),
    );
  });
});
