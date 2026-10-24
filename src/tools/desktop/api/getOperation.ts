import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { DesktopCache } from '../../../desktop/cache.js';
import { OperationEnvelope } from '../../../desktop/externalApi/types.js';
import { redactDatasourceCredentials } from '../../../desktop/limits/datasourceCredentialRedaction.js';
import {
  isOverInlineXmlCap,
  logInlineXmlCapHit,
  xmlByteLength,
} from '../../../desktop/limits/inlineXmlCap.js';
import { writeRedactedXmlCacheFile } from '../../../desktop/limits/redactedXmlCache.js';
import { sourceSha256, writeSidecar } from '../../../desktop/wrappers/cacheFingerprint.js';
import { runExternalApiTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: sessionParam(),
  operationId: z.string().min(1).describe('The operation id, from the operations list.'),
};

const title = 'Get Operation';

export const getOperationTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'get-operation',
    minApiVersion: '0.2.0',
    title,
    description:
      'Get one Tableau Desktop operation by id: kind, state, result or error, warnings, and timestamps. blockingWindows and progressWindows appear only while it is not in a terminal state.',
    paramsSchema,
    annotations: {
      readOnlyHint: false, // Writes a cache file when the document is over the inline cap
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    callback: async ({ session, operationId }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute<OperationEnvelope>({
        extra,
        args: { session, operationId },
        callback: async () =>
          await runExternalApiTool({
            session,
            extra,
            callback: async (_executor, _signal, call, resolvedSession) => {
              const operation = await call(
                'operation',
                async (executor, signal) => await executor.getOperation(operationId, signal),
              );
              return operation.map((envelope) =>
                withCappedDocument(envelope, extra.config.inlineXmlMaxBytes, resolvedSession),
              );
            },
          }),
      });
    },
  });

  return tool;
};

function withCappedDocument(
  operation: OperationEnvelope,
  capBytes: number,
  resolvedSession: string,
): OperationEnvelope {
  const { result } = operation;
  if (typeof result?.document !== 'string') {
    return operation;
  }

  const { document, ...rest } = result;
  const redacted = redactDatasourceCredentials(document);
  const bytes = xmlByteLength(redacted);
  if (!isOverInlineXmlCap(bytes, capBytes)) {
    return { ...operation, result: { ...rest, document: redacted } };
  }

  const file = new DesktopCache().getCacheFilePath({
    prefix: `operation-${operation.id.replace(/[^a-zA-Z0-9]/g, '_')}`,
  });
  writeRedactedXmlCacheFile(file, redacted);
  writeSidecar(file, resolvedSession, sourceSha256(redacted));
  logInlineXmlCapHit({ tool: 'get-operation', bytes, capBytes, file });
  return {
    ...operation,
    result: {
      ...rest,
      documentFile: file,
      documentMessage: `The document is ${bytes} bytes, over the ${capBytes}-byte inline cap, so it was saved to documentFile. Use read-cached-xml with startByte/endByte to read a slice.`,
    },
  };
}
