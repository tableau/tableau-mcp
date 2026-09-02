import { Err, Ok } from 'ts-results-es';

import { makeExecutorMock } from '../../../desktop/externalApi/executor.mock.js';
import { ExecuteCommandError } from '../../../desktop/externalApi/executorTypes.js';
import * as sessionResolution from '../../../desktop/session/sessionResolution.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { resolveDatasourceRef } from './resolveDatasourceRef.js';

vi.mock('../../../desktop/session/sessionResolution.js');

describe('resolveDatasourceRef', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('resolved-999'));
  });

  it('gives an exact inventory id priority over the same text as another datasource name', async () => {
    const { executor, extra } = harnessFor([
      { id: 'shared-value', name: 'Resolved by id' },
      { id: 'other-id', name: 'shared-value' },
    ]);

    const result = await resolveDatasourceRef({
      session: 'requested-session',
      datasourceName: 'shared-value',
      extra,
    });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({
      id: 'shared-value',
      name: 'Resolved by id',
      resolvedSession: 'resolved-999',
    });
    expect(sessionResolution.resolveSession).toHaveBeenCalledWith('requested-session');
    expect(extra.getExecutor).toHaveBeenCalledWith('resolved-999');
    expect(executor.listWorkbookDatasources).toHaveBeenCalledOnce();
    expect(executor.listWorkbookDatasources).toHaveBeenCalledWith(extra.signal);
  });

  it('resolves a unique exact datasource name', async () => {
    const { extra } = harnessFor([
      { id: 'sales-id', name: 'Sales' },
      { id: 'profit-id', name: 'Profit' },
    ]);

    const result = await resolveDatasourceRef({
      session: undefined,
      datasourceName: 'Profit',
      extra,
    });

    expect(result.unwrap()).toEqual({
      id: 'profit-id',
      name: 'Profit',
      resolvedSession: 'resolved-999',
    });
  });

  it('uses the generic resolver single entity-decoding behavior', async () => {
    const { extra } = harnessFor([
      { id: 'sales-profit-id', name: 'Sales & Profit' },
      { id: 'other-id', name: 'Other' },
    ]);

    const result = await resolveDatasourceRef({
      session: undefined,
      datasourceName: 'Sales &amp; Profit',
      extra,
    });

    expect(result.unwrap()).toEqual({
      id: 'sales-profit-id',
      name: 'Sales & Profit',
      resolvedSession: 'resolved-999',
    });
  });

  it('returns the existing ambiguity error and makes no granular datasource call', async () => {
    const { executor, extra } = harnessFor([
      { id: 'first-id', name: 'Duplicate' },
      { id: 'second-id', name: 'Duplicate' },
    ]);

    const result = await resolveDatasourceRef({
      session: undefined,
      datasourceName: 'Duplicate',
      extra,
    });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toMatchObject({ type: 'args-validation' });
    expect(result.unwrapErr().message).toContain('matched multiple datasources');
    expect(executor.listWorkbookDatasources).toHaveBeenCalledOnce();
    expectNoGranularCall(executor);
  });

  it('returns the existing not-found error and makes no granular datasource call', async () => {
    const { executor, extra } = harnessFor([{ id: 'sales-id', name: 'Sales' }]);

    const result = await resolveDatasourceRef({
      session: undefined,
      datasourceName: 'Missing',
      extra,
    });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toMatchObject({ type: 'args-validation' });
    expect(result.unwrapErr().message).toContain('Datasource "Missing" was not found');
    expect(executor.listWorkbookDatasources).toHaveBeenCalledOnce();
    expectNoGranularCall(executor);
  });

  it.each(['id-without-name', 'name-without-id'])(
    'does not resolve an incomplete fail-open inventory entry by %s',
    async (datasourceName) => {
      const { executor, extra } = harnessFor([
        { id: 'id-without-name' },
        { name: 'name-without-id' },
        { id: 'complete-id', name: 'Complete' },
      ]);

      const result = await resolveDatasourceRef({
        session: undefined,
        datasourceName,
        extra,
      });

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toMatchObject({ type: 'args-validation' });
      expect(result.unwrapErr().message).toContain('Complete (complete-id)');
      expect(result.unwrapErr().message).not.toContain('id-without-name (');
      expect(result.unwrapErr().message).not.toContain('name-without-id (');
      expect(executor.listWorkbookDatasources).toHaveBeenCalledOnce();
      expectNoGranularCall(executor);
    },
  );

  it('maps a missing inventory route through the existing read error flow', async () => {
    const routeMissing: ExecuteCommandError = {
      type: 'command-failed',
      error: {
        code: 'not-found',
        message: 'No route matches GET /v0/workbook/datasources',
        recoverable: false,
      },
    };
    const executor = makeExecutorMock({
      listWorkbookDatasources: vi.fn().mockResolvedValue(Err(routeMissing)),
    });
    const extra = {
      ...getMockRequestHandlerExtra(),
      getExecutor: vi.fn().mockResolvedValue(executor),
    };

    const result = await resolveDatasourceRef({
      session: undefined,
      datasourceName: 'Sales',
      extra,
    });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toMatchObject({
      type: 'endpoint-not-in-this-build',
      statusCode: 404,
    });
    expect(result.unwrapErr().message).toContain('workbook datasources endpoint');
    expect(executor.listWorkbookDatasources).toHaveBeenCalledOnce();
    expectNoGranularCall(executor);
  });
});

function harnessFor(datasources: Array<Record<string, unknown>>): {
  executor: ReturnType<typeof makeExecutorMock>;
  extra: ReturnType<typeof getMockRequestHandlerExtra> & {
    getExecutor: ReturnType<typeof vi.fn>;
  };
} {
  const executor = makeExecutorMock({
    listWorkbookDatasources: vi.fn().mockResolvedValue(Ok({ datasources })),
  });
  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: vi.fn().mockResolvedValue(executor),
  };
  return { executor, extra };
}

function expectNoGranularCall(executor: ReturnType<typeof makeExecutorMock>): void {
  expect(executor.getWorkbookDatasource).not.toHaveBeenCalled();
  expect(executor.getDatasourceDocument).not.toHaveBeenCalled();
  expect(executor.applyDatasourceDocument).not.toHaveBeenCalled();
}
