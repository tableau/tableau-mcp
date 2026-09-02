import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { currentEpisodeId, emitEpisodeEvent } from '../../../desktop/episode-events.js';
import type { ExecuteCommandWarning } from '../../../desktop/externalApi/executorTypes.js';
import { endpointNotInThisBuild, isRouteMissing } from '../../../desktop/externalApi/toolUtils.js';
import { applyDatasourceXml } from '../../../desktop/wrappers/applyDatasourceXml.js';
import { DesktopCommandExecutionError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { artifactFileParam, artifactNameParam, sessionParam } from '../params.js';
import { jsonToolResult, type StructuredResult } from '../structuredContent.js';
import { DesktopTool } from '../tool.js';
import { acceptedNoReadbackApplyResult, runApplyPreamble } from './applyPreamble.js';
import { resolveDatasourceRef } from './resolveDatasourceRef.js';

const paramsSchema = {
  session: sessionParam(),
  datasourceName: artifactNameParam('datasource'),
  datasourceFile: artifactFileParam('datasource').optional(),
};

type ApplyDatasourceResult = StructuredResult<{
  message: string;
  warnings: ExecuteCommandWarning[];
}>;

const title = 'Applying datasource changes';
export const getApplyDatasourceTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'apply-datasource',
    title,
    description: 'Apply a cached local workbook definition to one datasource by name or id.',
    paramsSchema,
    minApiVersion: '0.2.10',
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
    callback: async (
      { session, datasourceName, datasourceFile },
      extra,
    ): Promise<CallToolResult> => {
      return await tool.logAndExecute<ApplyDatasourceResult>({
        extra,
        args: { session, datasourceName, datasourceFile },
        callback: async () => {
          const datasource = await resolveDatasourceRef({ session, datasourceName, extra });
          if (datasource.isErr()) {
            return datasource;
          }
          const resolved = datasource.value;

          // Resolution must complete before any cache path is opened. A missing or ambiguous
          // datasource therefore cannot trigger local file access or an apply attempt.
          const preamble = runApplyPreamble({
            kind: 'datasource',
            file: datasourceFile,
            session: resolved.resolvedSession,
            emptyPathGuidance:
              'Use a cached datasource path, edit it with the cache read/write tools, then pass that path here.',
            notFoundGuidance: 'Provide an existing cached datasource path.',
            secureContainedCacheRead: true,
          });
          if (preamble.isErr()) {
            return preamble;
          }

          const executor = await extra.getExecutor(preamble.value.resolvedSession);
          const result = await applyDatasourceXml({
            datasourceId: resolved.id,
            xml: preamble.value.xml,
            executor,
            signal: extra.signal,
          });
          if (result.isErr()) {
            if (isRouteMissing(result.error)) {
              return endpointNotInThisBuild('datasource document').toErr();
            }
            return new DesktopCommandExecutionError(result.error).toErr();
          }

          const warnings = result.value.warnings ?? [];
          await emitEpisodeEvent(extra.config, {
            type: 'apply_succeeded',
            session_id: preamble.value.resolvedSession,
            episode_id: currentEpisodeId(preamble.value.resolvedSession),
            tool: 'apply-datasource',
            operation: 'apply datasource document',
            promise_outcome: 'unverified',
          });

          return new Ok({
            ...acceptedNoReadbackApplyResult({
              kind: 'datasource',
              appliedName: resolved.name,
              resultWarnings: warnings,
              hostVerification: ' No post-apply datasource readback ran.',
            }),
            warnings,
          });
        },
        getSuccessResult: (result) => jsonToolResult(result, { isError: false }),
      });
    },
  });

  return tool;
};
