import { CallToolResult } from '@modelcontextprotocol/server';
import { readFileSync, rmSync } from 'fs';
import { Err, Ok } from 'ts-results-es';

import * as externalDiscovery from '../../../desktop/externalApi/discovery.js';
import { makeExecutorMock } from '../../../desktop/externalApi/executor.mock.js';
import type { ExecuteCommandError } from '../../../desktop/externalApi/executorTypes.js';
import { REDACTED_CREDENTIAL_SENTINEL } from '../../../desktop/limits/datasourceCredentialRedaction.js';
import * as sessionResolution from '../../../desktop/session/sessionResolution.js';
import { sidecarPath, sourceSha256 } from '../../../desktop/wrappers/cacheFingerprint.js';
import * as loggerModule from '../../../logging/logger.js';
import { notifier } from '../../../logging/notification.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { TableauDesktopToolContext } from '../toolContext.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getXmlTool } from './getXml.js';

vi.mock('../../../desktop/session/sessionResolution.js');

describe('getXmlTool kind=datasource', () => {
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

  it('reads a datasource by id after resolving it', async () => {
    const { result, order } = await invoke({
      datasourceId: 'Sales%20Extract',
      mode: 'inline',
      xml: '<datasource name="Sales"/>',
    });

    expect(result.isError).toBe(false);
    expect(order).toEqual(['list', 'document:Sales%20Extract']);
    expect(resultBody(result).datasourceXml).toContain('<datasource name="Sales"');
  });

  it.each([
    {
      label: 'unique name',
      datasourceId: 'Profit',
      datasources: [
        { id: 'Sales%20Extract', name: 'Sales' },
        { id: 'Profit%2FExtract', name: 'Profit' },
      ],
      expectedId: 'Profit%2FExtract',
      expectedName: 'Profit',
    },
    {
      label: 'one entity-decoded name',
      datasourceId: 'Sales &amp; Profit',
      datasources: [{ id: 'Sales%20%26%20Profit', name: 'Sales & Profit' }],
      expectedId: 'Sales%20%26%20Profit',
      expectedName: 'Sales & Profit',
    },
  ])(
    'resolves a $label to its id before reading the document',
    async ({ datasourceId, datasources, expectedId, expectedName }) => {
      const { result, order, executor } = await invoke({
        datasourceId,
        datasources,
        mode: 'inline',
        xml: `<datasource name="${expectedName}"/>`,
      });

      expect(result.isError).toBe(false);
      expect(order).toEqual(['list', `document:${expectedId}`]);
      expect(executor.getWorkbookDocument).not.toHaveBeenCalled();
      expect(resultBody(result).datasourceXml).toContain(`<datasource name="${expectedName}"`);
    },
  );

  it.each([
    { args: { kind: 'datasource' }, message: 'datasourceId is required with kind datasource.' },
    {
      args: { kind: 'datasource', datasourceId: 'Sales', sheetId: 'sheet-1' },
      message: 'sheetId does not apply to kind datasource.',
    },
    { args: { datasourceId: 'Sales' }, message: 'datasourceId requires kind datasource.' },
    {
      args: { kind: 'worksheet', sheetId: 'sheet-1', datasourceId: 'Sales' },
      message: 'datasourceId requires kind datasource.',
    },
  ])('rejects $args without a request', async ({ args, message }) => {
    const executor = makeExecutorMock();
    const callback = await Provider.from(getXmlTool(new DesktopMcpServer()).callback);
    const extra = {
      ...getMockRequestHandlerExtra(),
      getExecutor: vi
        .fn()
        .mockResolvedValue(executor) as unknown as TableauDesktopToolContext['getExecutor'],
    };

    const result = await callback(
      { session: 'requested', mode: 'inline', ...args } as never,
      extra,
    );

    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain(message);
    expect(executor.getDatasourceDocument).not.toHaveBeenCalled();
  });

  it.each([
    {
      datasourceId: 'Duplicate',
      datasources: [
        { id: 'first', name: 'Duplicate' },
        { id: 'second', name: 'Duplicate' },
      ],
      expected: 'matched multiple datasources',
    },
    {
      datasourceId: 'Missing',
      datasources: [{ id: 'sales', name: 'Sales' }],
      expected: 'was not found',
    },
  ])(
    'stops without a document read when resolution fails for $datasourceId',
    async ({ datasourceId, datasources, expected }) => {
      const { result, order } = await invoke({
        datasourceId,
        datasources,
        mode: 'inline',
      });

      expect(result.isError).toBe(true);
      expect(resultText(result)).toContain(expected);
      expect(order).toEqual(['list']);
    },
  );

  it('returns a small datasource document inline without credential values', async () => {
    const xml =
      '<datasource name="Sales"><connection oauth-access-token="inline-secret" ' +
      'url="https://example.invalid?access_token=embedded-inline-secret" ' +
      'connection-string="Server=example.invalid; Password = whitespace-inline-secret" ' +
      'odbc-connect-string="UID=user;PWD=pwd-inline-secret"/>' +
      '<column name="[Sales]"/></datasource>';
    const { result } = await invoke({ datasourceId: 'Sales%20Extract', mode: 'inline', xml });

    expect(result.isError).toBe(false);
    const body = resultBody(result);
    expect(body.datasourceXml).toBe(
      `<datasource name="Sales"><connection oauth-access-token="${REDACTED_CREDENTIAL_SENTINEL}" url="${REDACTED_CREDENTIAL_SENTINEL}" ` +
        `connection-string="${REDACTED_CREDENTIAL_SENTINEL}" odbc-connect-string="${REDACTED_CREDENTIAL_SENTINEL}"/>` +
        '<column name="[Sales]"/></datasource>',
    );
    expect(resultText(result)).not.toContain('inline-secret');
    expect(resultText(result)).not.toContain('embedded-inline-secret');
    expect(resultText(result)).not.toContain('whitespace-inline-secret');
    expect(resultText(result)).not.toContain('pwd-inline-secret');
    expect(body.message).toContain('returned inline');
  });

  it('returns calc formulas and captions that look like credential pairs intact', async () => {
    const xml =
      "<datasource name='Sales'><column caption='pwd=1' name='[Token]'>" +
      "<calculation class='tableau' formula='[Token]=1'/></column></datasource>";
    const { result } = await invoke({ datasourceId: 'Sales%20Extract', mode: 'inline', xml });

    expect(resultBody(result).datasourceXml).toBe(xml);
  });

  it('redacts credentials before writing the document and fingerprint sidecar', async () => {
    const xml =
      '<datasource name="federated.sales" caption="Sales">' +
      '<connection password="must-not-appear" oauth-refresh-token="also-secret" ' +
      'connection-string="Server=example.invalid; Password = whitespace-cache-secret" ' +
      'odbc-connect-string="UID=user;PWD=pwd-cache-secret"/>' +
      '<column/><relation/>' +
      '</datasource>';
    const redactedXml =
      '<datasource name="federated.sales" caption="Sales">' +
      `<connection password="${REDACTED_CREDENTIAL_SENTINEL}" oauth-refresh-token="${REDACTED_CREDENTIAL_SENTINEL}" ` +
      `connection-string="${REDACTED_CREDENTIAL_SENTINEL}" odbc-connect-string="${REDACTED_CREDENTIAL_SENTINEL}"/>` +
      '<column/><relation/>' +
      '</datasource>';
    const { result } = await invoke({ datasourceId: 'Sales%20Extract', mode: 'file', xml });
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
    expect(readFileSync(body.file, 'utf-8')).not.toContain('whitespace-cache-secret');
    expect(readFileSync(body.file, 'utf-8')).not.toContain('pwd-cache-secret');
    expect(body.instructions).toContain('datasourceFile');
  });

  it('forces oversized inline content to a datasource-specific cache workflow', async () => {
    const xml = `<datasource name="Sales">${'x'.repeat(64)}</datasource>`;
    const { result } = await invoke({
      datasourceId: 'Sales%20Extract',
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

  it('returns the document error after resolving the datasource', async () => {
    const { result, order } = await invoke({
      datasourceId: 'Sales%20Extract',
      mode: 'inline',
      documentError: {
        type: 'command-failed',
        error: { code: 'internal-error', message: 'Desktop failed.', recoverable: false },
      },
    });

    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain('Desktop failed.');
    expect(order).toEqual(['list', 'document:Sales%20Extract']);
  });

  it('passes the request abort signal to the list and document reads', async () => {
    const signal = new AbortController().signal;
    const { executor } = await invoke({
      datasourceId: 'Sales',
      mode: 'inline',
      signal,
    });

    expect(executor.listWorkbookDatasources).toHaveBeenCalledWith(signal);
    expect(executor.getDatasourceDocument).toHaveBeenCalledWith('Sales%20Extract', signal);
  });

  async function invoke({
    datasourceId,
    mode,
    datasources = [{ id: 'Sales%20Extract', name: 'Sales' }],
    xml,
    capBytes,
    documentError,
    signal,
  }: {
    datasourceId: string;
    mode: 'file' | 'inline';
    datasources?: Array<Record<string, unknown>>;
    xml?: string;
    capBytes?: number;
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
      return Ok({ datasources });
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
    const tool = getXmlTool(new DesktopMcpServer());
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
    const result = await callback(
      { session: 'requested', kind: 'datasource', sheetId: undefined, datasourceId, mode },
      extra,
    );
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
