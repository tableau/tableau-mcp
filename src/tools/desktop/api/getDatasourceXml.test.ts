import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { readFileSync, rmSync } from 'fs';
import { Err, Ok } from 'ts-results-es';

import * as externalDiscovery from '../../../desktop/externalApi/discovery.js';
import { makeExecutorMock } from '../../../desktop/externalApi/executor.mock.js';
import type { ExecuteCommandError } from '../../../desktop/externalApi/executorTypes.js';
import * as sessionResolution from '../../../desktop/session/sessionResolution.js';
import { sidecarPath, sourceSha256 } from '../../../desktop/wrappers/cacheFingerprint.js';
import * as loggerModule from '../../../logging/logger.js';
import { notifier } from '../../../logging/notification.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { TableauDesktopToolContext } from '../toolContext.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getGetDatasourceXmlTool } from './getDatasourceXml.js';

vi.mock('../../../desktop/session/sessionResolution.js');

const routeMissing: ExecuteCommandError = {
  type: 'command-failed',
  error: {
    code: 'not-found',
    message: 'No route matches GET /v0/workbook/datasources/target/document',
    recoverable: false,
  },
};

describe('getGetDatasourceXmlTool', () => {
  const writtenFiles: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('123'));
    vi.spyOn(externalDiscovery, 'discoverInstances').mockReturnValue([
      {
        pid: 123,
        instanceId: 'instance-123',
      } as ReturnType<typeof externalDiscovery.discoverInstances>[number],
    ]);
    vi.spyOn(loggerModule, 'log').mockImplementation(() => undefined);
    vi.spyOn(notifier, 'debug').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const file of writtenFiles.splice(0)) {
      rmSync(file, { force: true });
      rmSync(sidecarPath(file), { force: true });
    }
  });

  it('has the expected schema, annotations, and API floor', () => {
    const tool = getGetDatasourceXmlTool(new DesktopMcpServer());

    expect(tool.name).toBe('get-datasource-xml');
    expect(tool.minApiVersion).toBe('0.2.10');
    expect(tool.paramsSchema).toMatchObject({
      session: expect.any(Object),
      datasourceName: expect.any(Object),
      mode: expect.any(Object),
    });
    expect(tool.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
  });

  it.each([
    {
      label: 'exact inventory id with priority over a matching name',
      datasourceName: 'shared',
      datasources: [
        { id: 'shared', name: 'Resolved by id' },
        { id: 'other', name: 'shared' },
      ],
      expectedId: 'shared',
      expectedName: 'Resolved by id',
    },
    {
      label: 'unique name',
      datasourceName: 'Profit',
      datasources: [
        { id: 'Sales%20Extract', name: 'Sales' },
        { id: 'Profit%2FExtract', name: 'Profit' },
      ],
      expectedId: 'Profit%2FExtract',
      expectedName: 'Profit',
    },
    {
      label: 'one entity-decoded name',
      datasourceName: 'Sales &amp; Profit',
      datasources: [{ id: 'Sales%20%26%20Profit', name: 'Sales & Profit' }],
      expectedId: 'Sales%20%26%20Profit',
      expectedName: 'Sales & Profit',
    },
  ])(
    'resolves $label before the granular document GET',
    async ({ datasourceName, datasources, expectedId, expectedName }) => {
      const { result, order, executor } = await invoke({
        datasourceName,
        datasources,
        mode: 'inline',
        xml: `<datasource name="${expectedName}"/>`,
      });

      expect(result.isError).toBe(false);
      expect(order).toEqual(['list', `document:${expectedId}`]);
      expect(executor.getDatasourceDocument).toHaveBeenCalledWith(expectedId, expect.any(Object));
      expect(executor.getWorkbookDocument).not.toHaveBeenCalled();
      const body = resultBody(result);
      expect(body.datasourceXml).toContain(`<datasource name="${expectedName}"`);
    },
  );

  it.each([
    {
      datasourceName: 'Duplicate',
      datasources: [
        { id: 'first', name: 'Duplicate' },
        { id: 'second', name: 'Duplicate' },
      ],
      expected: 'matched multiple datasources',
    },
    {
      datasourceName: 'Missing',
      datasources: [{ id: 'sales', name: 'Sales' }],
      expected: 'was not found',
    },
  ])(
    'stops after inventory resolution fails for $datasourceName',
    async ({ datasourceName, datasources, expected }) => {
      const { result, order, executor } = await invoke({
        datasourceName,
        datasources,
        mode: 'inline',
      });

      expect(result.isError).toBe(true);
      expect(resultText(result)).toContain(expected);
      expect(order).toEqual(['list']);
      expect(executor.getDatasourceDocument).not.toHaveBeenCalled();
    },
  );

  it('returns a small datasource document inline without credential values', async () => {
    const xml =
      '<datasource name="Sales"><connection oauth-access-token="inline-secret" ' +
      'url="https://example.invalid?access_token=embedded-inline-secret"/>' +
      '<column name="[Sales]"/></datasource>';
    const { result } = await invoke({ datasourceName: 'Sales', mode: 'inline', xml });

    expect(result.isError).toBe(false);
    const body = resultBody(result);
    expect(body.datasourceXml).toBe(
      '<datasource name="Sales"><connection oauth-access-token="" url=""/>' +
        '<column name="[Sales]"/></datasource>',
    );
    expect(resultText(result)).not.toContain('inline-secret');
    expect(resultText(result)).not.toContain('embedded-inline-secret');
    expect(body.message).toContain('returned inline');
  });

  it('redacts credentials before writing the document and fingerprint sidecar', async () => {
    const xml =
      '<datasource name="federated.sales" caption="Sales">' +
      '<connection password="must-not-appear" oauth-refresh-token="also-secret" ' +
      'connection-string="Server=example.invalid;Password=embedded-cache-secret"/>' +
      '<column/><relation/>' +
      '</datasource>';
    const redactedXml =
      '<datasource name="federated.sales" caption="Sales">' +
      '<connection password="" oauth-refresh-token="" connection-string=""/>' +
      '<column/><relation/>' +
      '</datasource>';
    const { result } = await invoke({ datasourceName: 'Sales', mode: 'file', xml });
    const body = resultBody(result);
    invariant(typeof body.file === 'string');

    expect(readFileSync(body.file, 'utf-8')).toBe(redactedXml);
    const sidecar = JSON.parse(readFileSync(sidecarPath(body.file), 'utf-8')) as Record<
      string,
      unknown
    >;
    expect(sidecar).toMatchObject({
      session_id: '123',
      pid: 123,
      instanceId: 'instance-123',
      source_sha256: sourceSha256(redactedXml),
    });
    expect(body.message).toContain('datasource name: federated.sales');
    expect(body.message).toContain('connections: 1');
    expect(body.message).not.toContain('must-not-appear');
    expect(body.message).not.toContain('also-secret');
    expect(readFileSync(body.file, 'utf-8')).not.toContain('embedded-cache-secret');
    expect(body.instructions).toContain('datasourceFile');
  });

  it('forces oversized inline content to a datasource-specific cache workflow', async () => {
    const xml = `<datasource name="Sales">${'x'.repeat(64)}</datasource>`;
    const { result } = await invoke({
      datasourceName: 'Sales',
      mode: 'inline',
      xml,
      capBytes: 8,
    });
    const body = resultBody(result);

    expect(body.datasourceXml).toBeUndefined();
    expect(body.file).toEqual(expect.any(String));
    expect(body.message).toContain('inline cap');
    expect(body.instructions).toContain('startByte/endByte');
    expect(body.instructions).toContain('without a worksheet/dashboard selector');
    expect(body.instructions).toContain('datasourceFile');
  });

  it.each([
    ['inventory', { listError: routeMissing }],
    ['granular document', { documentError: routeMissing }],
  ] as const)(
    'maps a missing %s route through the standard read harness',
    async (_label, errors) => {
      const { result } = await invoke({ datasourceName: 'Sales', mode: 'inline', ...errors });

      expect(result.isError).toBe(true);
      expect(resultText(result)).toContain('endpoint yet');
      expect(resultText(result)).toContain('Do not retry');
    },
  );

  it('keeps a real granular datasource-not-found separate from route absence', async () => {
    const { result } = await invoke({
      datasourceName: 'Sales',
      mode: 'inline',
      documentError: {
        type: 'command-failed',
        error: {
          code: 'datasource-not-found',
          message: 'The datasource no longer exists.',
          recoverable: false,
        },
      },
    });

    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain('The datasource no longer exists.');
    expect(resultText(result)).not.toContain('Desktop build is too old');
  });

  it('passes the request abort signal to the inventory and granular reads', async () => {
    const signal = new AbortController().signal;
    const { executor } = await invoke({ datasourceName: 'Sales', mode: 'inline', signal });

    expect(executor.listWorkbookDatasources).toHaveBeenCalledWith(signal);
    expect(executor.getDatasourceDocument).toHaveBeenCalledWith('Sales%20Extract', signal);
  });

  async function invoke({
    datasourceName,
    mode,
    datasources = [{ id: 'Sales%20Extract', name: 'Sales' }],
    xml,
    capBytes,
    listError,
    documentError,
    signal,
  }: {
    datasourceName: string;
    mode: 'file' | 'inline';
    datasources?: Array<Record<string, unknown>>;
    xml?: string;
    capBytes?: number;
    listError?: ExecuteCommandError;
    documentError?: ExecuteCommandError;
    signal?: AbortSignal;
  }): Promise<{
    result: CallToolResult;
    order: string[];
    executor: ReturnType<typeof makeExecutorMock>;
  }> {
    const order: string[] = [];
    const listWorkbookDatasources = vi.fn(async () => {
      order.push('list');
      return listError ? Err(listError) : Ok({ datasources });
    });
    const getDatasourceDocument = vi.fn(async (id: string) => {
      order.push(`document:${id}`);
      return documentError
        ? Err(documentError)
        : Ok({
            xml: xml ?? `<datasource name="${datasources[0]?.name ?? 'Datasource'}"/>`,
            applicationVersion: undefined,
            xsdPayloadVersion: undefined,
          });
    });
    const executor = makeExecutorMock({ listWorkbookDatasources, getDatasourceDocument });
    const tool = getGetDatasourceXmlTool(new DesktopMcpServer());
    const callback = await Provider.from(tool.callback);
    const base = getMockRequestHandlerExtra();
    const extra = {
      ...base,
      getExecutor: vi
        .fn()
        .mockResolvedValue(executor) as unknown as TableauDesktopToolContext['getExecutor'],
      ...(capBytes === undefined
        ? {}
        : { config: { ...base.config, inlineXmlMaxBytes: capBytes } }),
      ...(signal === undefined ? {} : { signal }),
    };
    const result = await callback({ session: 'requested', datasourceName, mode }, extra);
    const body = result.isError ? undefined : resultBody(result);
    if (typeof body?.file === 'string') writtenFiles.push(body.file);
    return { result, order, executor };
  }
});

function resultText(result: CallToolResult): string {
  invariant(result.content[0].type === 'text');
  return result.content[0].text;
}

function resultBody(result: CallToolResult): Record<string, unknown> {
  return JSON.parse(resultText(result)) as Record<string, unknown>;
}
