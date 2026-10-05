import { Err, Ok } from 'ts-results-es';

import { makeExecutorMock } from '../externalApi/executor.mock.js';
import { applyDatasourceXml } from './applyDatasourceXml.js';

describe('applyDatasourceXml', () => {
  const signal = new AbortController().signal;

  it('sends the exact bytes to only the resolved datasource route', async () => {
    const xml =
      '\n  <datasource name="Sales &amp; Profit">\n    <connection />\n  </datasource>  \n';
    const executorResult = Ok({
      command_id: 'apply-datasource',
      status: 'completed' as const,
      submitted_at: '2026-09-01T00:00:00Z',
    });
    const applyDatasourceDocument = vi.fn().mockResolvedValue(executorResult);
    const applyWorkbookDocument = vi.fn();
    const executor = makeExecutorMock({ applyDatasourceDocument, applyWorkbookDocument });

    const result = await applyDatasourceXml({
      datasourceId: 'Sales%20%26%20Profit',
      xml,
      executor,
      signal,
    });

    expect(result).toBe(executorResult);
    expect(applyDatasourceDocument).toHaveBeenCalledOnce();
    expect(applyDatasourceDocument).toHaveBeenCalledWith('Sales%20%26%20Profit', xml, signal);
    expect(executor.getWorkbookDocument).not.toHaveBeenCalled();
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('returns the executor failure unchanged', async () => {
    const error = {
      type: 'command-failed' as const,
      error: { code: 'conflict', message: 'Datasource target mismatch', recoverable: false },
    };
    const executorResult = Err(error);
    const executor = makeExecutorMock({
      applyDatasourceDocument: vi.fn().mockResolvedValue(executorResult),
    });

    const result = await applyDatasourceXml({
      datasourceId: 'Sales',
      xml: '<datasource/>',
      executor,
      signal,
    });

    expect(result).toBe(executorResult);
    expect(result.unwrapErr()).toBe(error);
  });

  it('serializes concurrent datasource applies through the shared apply mutex', async () => {
    let releaseFirst: (() => void) | undefined;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const order: string[] = [];
    const applyDatasourceDocument = vi.fn(async (id: string) => {
      order.push(`start:${id}`);
      if (id === 'first') await firstBlocked;
      order.push(`finish:${id}`);
      return Ok({
        command_id: id,
        status: 'completed' as const,
        submitted_at: '2026-09-01T00:00:00Z',
      });
    });
    const executor = makeExecutorMock({ applyDatasourceDocument });

    const first = applyDatasourceXml({
      datasourceId: 'first',
      xml: '<datasource name="first"/>',
      executor,
      signal,
    });
    const second = applyDatasourceXml({
      datasourceId: 'second',
      xml: '<datasource name="second"/>',
      executor,
      signal,
    });

    await vi.waitFor(() => expect(order).toEqual(['start:first']));
    releaseFirst?.();
    await Promise.all([first, second]);

    expect(order).toEqual(['start:first', 'finish:first', 'start:second', 'finish:second']);
  });
});
