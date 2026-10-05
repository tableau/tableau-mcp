import { Err, Ok } from 'ts-results-es';

import { makeExecutorMock } from '../externalApi/executor.mock.js';
import { getWorkbookXml } from './getWorkbookXml.js';

describe('getWorkbookXml', () => {
  const mockSignal = new AbortController().signal;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should successfully return workbook XML', async () => {
    const mockXml = '<?xml version="1.0"?><workbook><worksheets></worksheets></workbook>';
    const mockExecutor = makeExecutorMock({
      getWorkbookDocument: vi.fn().mockResolvedValue(
        Ok({
          xml: mockXml,
          applicationVersion: undefined,
          xsdPayloadVersion: undefined,
        }),
      ),
    });

    const result = await getWorkbookXml({ executor: mockExecutor, signal: mockSignal });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe(mockXml);
    }

    expect(mockExecutor.getWorkbookDocument).toHaveBeenCalledWith(mockSignal);
  });

  it('should return large workbook XML', async () => {
    const largeXml = '<?xml version="1.0"?><workbook>' + '<worksheet>'.repeat(1000) + '</workbook>';
    const mockExecutor = makeExecutorMock({
      getWorkbookDocument: vi.fn().mockResolvedValue(
        Ok({
          xml: largeXml,
          applicationVersion: undefined,
          xsdPayloadVersion: undefined,
        }),
      ),
    });

    const result = await getWorkbookXml({ executor: mockExecutor, signal: mockSignal });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe(largeXml);
      expect(result.value.length).toBeGreaterThan(10000);
    }
  });

  it('should return error when document read fails', async () => {
    const error = { type: 'command-failed' as const, error: { code: 'ERROR', message: 'Failed' } };
    const mockExecutor = makeExecutorMock({
      getWorkbookDocument: vi.fn().mockResolvedValue(Err(error)),
    });

    const result = await getWorkbookXml({ executor: mockExecutor, signal: mockSignal });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toEqual(error);
    }
  });

  it('should handle empty XML text', async () => {
    const mockExecutor = makeExecutorMock({
      getWorkbookDocument: vi.fn().mockResolvedValue(
        Ok({
          xml: '',
          applicationVersion: undefined,
          xsdPayloadVersion: undefined,
        }),
      ),
    });

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
    const mockExecutor = makeExecutorMock({
      getWorkbookDocument: vi.fn().mockResolvedValue(
        Ok({
          xml: mockXml,
          applicationVersion: undefined,
          xsdPayloadVersion: undefined,
        }),
      ),
    });

    const result = await getWorkbookXml({ executor: mockExecutor, signal: mockSignal });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toContain('&amp;');
      expect(result.value).toContain('&lt;');
      expect(result.value).toContain('&gt;');
    }
  });

  it('should read through the workbook document method', async () => {
    const mockExecutor = makeExecutorMock({
      getWorkbookDocument: vi.fn().mockResolvedValue(
        Ok({
          xml: '<workbook></workbook>',
          applicationVersion: undefined,
          xsdPayloadVersion: undefined,
        }),
      ),
    });

    await getWorkbookXml({ executor: mockExecutor, signal: mockSignal });

    expect(mockExecutor.getWorkbookDocument).toHaveBeenCalledWith(mockSignal);
  });
});
