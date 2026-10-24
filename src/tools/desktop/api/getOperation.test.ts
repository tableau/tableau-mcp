import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { readFileSync, rmSync } from 'fs';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import * as externalDiscovery from '../../../desktop/externalApi/discovery.js';
import { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import {
  MockExternalApiServer,
  startMockExternalApiServer,
} from '../../../desktop/externalApi/mockExternalApiServer.js';
import { ExternalApiInstance, OperationEnvelope } from '../../../desktop/externalApi/types.js';
import { REDACTED_CREDENTIAL_SENTINEL } from '../../../desktop/limits/datasourceCredentialRedaction.js';
import * as sessionResolution from '../../../desktop/session/sessionResolution.js';
import { sidecarPath, sourceSha256 } from '../../../desktop/wrappers/cacheFingerprint.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getOperationTool } from './getOperation.js';

vi.mock('../../../desktop/session/sessionResolution.js');

const runningOperation = {
  id: 'op-1',
  kind: 'workbook.document.apply',
  state: 'RUNNING',
  blockingWindows: [],
  progressWindows: [],
};

const succeededOperation = {
  id: 'op-1',
  kind: 'workbook.getDocument',
  state: 'SUCCEEDED',
};

describe('get-operation tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('declares the contract', () => {
    const tool = getOperationTool(new DesktopMcpServer());

    expect(tool.name).toBe('get-operation');
    expect(tool.minApiVersion).toBe('0.2.0');
    expect(tool.description).toContain('progressWindows');
    expect(tool.paramsSchema).toMatchObject({
      session: expect.any(Object),
      operationId: expect.any(Object),
    });
    expect(tool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
  });

  it('requires a non-empty operation id', () => {
    const schema = z.object(getOperationTool(new DesktopMcpServer()).paramsSchema as z.ZodRawShape);

    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ operationId: '' }).success).toBe(false);
    expect(schema.safeParse({ operationId: 'op-1' }).success).toBe(true);
  });

  it('returns the operation envelope for the requested id', async () => {
    const harness = await startHarness();
    harness.server.setOperation('op-1', { poll: [runningOperation] });

    try {
      const result = await harness.callTool({ session: undefined, operationId: 'op-1' });

      expect(result.isError).toBe(false);
      expect(parseResult(result)).toEqual(runningOperation);
      expect(harness.server.requests.map((request) => request.path)).toContain(
        '/v0/operations/op-1',
      );
    } finally {
      await harness.close();
    }
  });

  it('returns a small document result inline without credential values', async () => {
    const harness = await startHarness();
    harness.server.setOperation('op-1', {
      poll: [
        {
          ...succeededOperation,
          result: {
            document:
              '<workbook><datasource name="Sales"><connection password="must-not-appear" server="db"/></datasource></workbook>',
            payloadVersion: '2026.3',
          },
        },
      ],
    });

    try {
      const result = await harness.callTool({ session: undefined, operationId: 'op-1' });

      const document = parseResult(result).result?.document;
      expect(document).toContain(REDACTED_CREDENTIAL_SENTINEL);
      expect(document).toContain('server="db"');
      expect(document).not.toContain('must-not-appear');
    } finally {
      await harness.close();
    }
  });

  it('moves an oversized document result to a redacted cache file with a session sidecar', async () => {
    const harness = await startHarness({ capBytes: 16 });
    vi.spyOn(externalDiscovery, 'discoverInstances').mockReturnValue([instanceFor(harness.server)]);
    harness.server.setOperation('op-1', {
      poll: [
        {
          ...succeededOperation,
          result: {
            document: '<workbook><connection password="must-not-appear"/></workbook>',
            payloadVersion: '2026.3',
          },
        },
      ],
    });

    try {
      const result = await harness.callTool({ session: undefined, operationId: 'op-1' });

      const operation = parseResult(result);
      const documentFile = operation.result?.documentFile;
      invariant(typeof documentFile === 'string');
      try {
        expect(operation.result).not.toHaveProperty('document');
        expect(operation.result?.payloadVersion).toBe('2026.3');
        expect(operation.result?.documentMessage).toContain('16-byte inline cap');
        const cached = readFileSync(documentFile, 'utf-8');
        expect(cached).toContain(REDACTED_CREDENTIAL_SENTINEL);
        expect(cached).not.toContain('must-not-appear');
        expect(JSON.parse(readFileSync(sidecarPath(documentFile), 'utf-8'))).toMatchObject({
          session_id: '999',
          pid: 999,
          instanceId: 'inst-get-operation',
          source_sha256: sourceSha256(cached),
        });
      } finally {
        rmSync(documentFile, { force: true });
        rmSync(sidecarPath(documentFile), { force: true });
      }
    } finally {
      await harness.close();
    }
  });

  it('returns an error for an unknown operation id', async () => {
    const harness = await startHarness();

    try {
      const result = await harness.callTool({ session: undefined, operationId: 'op-missing' });

      expect(result.isError).toBe(true);
    } finally {
      await harness.close();
    }
  });
});

function parseResult(result: CallToolResult): OperationEnvelope {
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text) as OperationEnvelope;
}

async function startHarness({ capBytes }: { capBytes?: number } = {}): Promise<{
  server: MockExternalApiServer;
  callTool: (args: { session: string | undefined; operationId: string }) => Promise<CallToolResult>;
  close: () => Promise<void>;
}> {
  const server = await startMockExternalApiServer();
  const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
  await executor.start();
  const tool = getOperationTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  const base = getMockRequestHandlerExtra();
  const extra = {
    ...base,
    ...(capBytes !== undefined && { config: { ...base.config, inlineXmlMaxBytes: capBytes } }),
    getExecutor: vi.fn().mockResolvedValue(executor),
  };

  return {
    server,
    callTool: async (args) => await callback(args, extra),
    close: async () => {
      executor.stop();
      await server.close();
    },
  };
}

function instanceFor(server: MockExternalApiServer): ExternalApiInstance {
  return {
    baseUrl: server.baseUrl,
    token: 'valid-token',
    pid: 999,
    instanceId: 'inst-get-operation',
    apiVersion: '0.2.25',
  };
}
