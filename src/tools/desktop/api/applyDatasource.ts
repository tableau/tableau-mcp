import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { checkCacheFileArg } from '../../../desktop/cachePath.js';
import { currentEpisodeId, emitEpisodeEvent } from '../../../desktop/episode-events.js';
import type { ExecuteCommandWarning } from '../../../desktop/externalApi/executorTypes.js';
import { endpointNotInThisBuild, isRouteMissing } from '../../../desktop/externalApi/toolUtils.js';
import { formatColorMapCheck } from '../../../desktop/validation/colorMapReadback.js';
import type { ReadbackVerificationResult } from '../../../desktop/validation/readback-verify.js';
import { applyDatasourceXml } from '../../../desktop/wrappers/applyDatasourceXml.js';
import { readColorMapsBack } from '../../../desktop/wrappers/readColorMapsBack.js';
import { DesktopCommandExecutionError } from '../../../errors/mcpToolError.desktop.js';
import { WorkbookNotFoundError } from '../../../errors/mcpToolError.js';
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
  verification?: ReadbackVerificationResult;
}>;

const title = 'Applying datasource changes';
export const getApplyDatasourceTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'apply-datasource',
    title,
    description:
      'Replace an existing datasource definition in the open workbook using a document previously retrieved from that workbook. ' +
      'Does not add datasources or import .tds/.tdsx files.',
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
          // Containment first: an outside or symlinked path must cost no Desktop round trip.
          if (datasourceFile?.trim()) {
            const checked = checkCacheFileArg(
              'datasourceFile',
              datasourceFile,
              (path) =>
                new WorkbookNotFoundError(
                  `Cached datasource file not found: ${path} Provide an existing cached datasource path.`,
                ),
            );
            if (checked.isErr()) {
              return checked.error.toErr();
            }
          }

          const datasource = await resolveDatasourceRef({ session, datasourceName, extra });
          if (datasource.isErr()) {
            return datasource;
          }
          const resolved = datasource.value;

          // The path check above is a metadata check only; the file is read after resolution,
          // so a missing or ambiguous datasource never reads the file or triggers an apply.
          const preamble = runApplyPreamble({
            kind: 'datasource',
            file: datasourceFile,
            session: resolved.resolvedSession,
            emptyPathGuidance:
              'Use a cached datasource path, edit it with the cache read/write tools, then pass that path here.',
            notFoundGuidance: 'Provide an existing cached datasource path.',
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
          const verification = await readColorMapsBack({
            appliedXml: preamble.value.xml,
            datasourceId: resolved.id,
            executor,
            signal: extra.signal,
          });
          await emitEpisodeEvent(extra.config, {
            type: 'apply_succeeded',
            session_id: preamble.value.resolvedSession,
            episode_id: currentEpisodeId(preamble.value.resolvedSession),
            tool: 'apply-datasource',
            operation: 'apply datasource document',
            promise_outcome: verification?.status === 'failed' ? 'failed' : 'unverified',
          });

          return new Ok({
            ...acceptedNoReadbackApplyResult({
              kind: 'datasource',
              appliedName: resolved.name,
              resultWarnings: warnings,
              hostVerification:
                verification === undefined
                  ? ' No post-apply datasource readback ran.'
                  : formatColorMapCheck(verification),
              verification,
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
