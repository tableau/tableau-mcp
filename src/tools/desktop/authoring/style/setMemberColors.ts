import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import {
  endpointNotInThisBuild,
  isRouteMissing,
} from '../../../../desktop/externalApi/toolUtils.js';
import { resolveSession } from '../../../../desktop/session/sessionResolution.js';
import {
  extractColorMaps,
  extractWorksheetStyleColorMaps,
  formatColorMapCheck,
  staleWorksheetStyleFindings,
} from '../../../../desktop/validation/colorMapReadback.js';
import { applyDatasourceXml } from '../../../../desktop/wrappers/applyDatasourceXml.js';
import { getWorksheetXml } from '../../../../desktop/wrappers/getWorksheetXml.js';
import { decodedId, readColorMapsBack } from '../../../../desktop/wrappers/readColorMapsBack.js';
import {
  DesktopCommandExecutionError,
  GetWorksheetXmlFailedError,
} from '../../../../errors/mcpToolError.desktop.js';
import {
  ArgsValidationError,
  UnknownError,
  XmlModificationError,
} from '../../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import { artifactNameParam, sessionParam } from '../../params.js';
import { DesktopTool } from '../../tool.js';
import { existingBuckets, spliceMemberColors } from './memberColorsSplice.js';
import { buildBuckets, resolveColorTarget } from './memberColorsTarget.js';

const paramsSchema = {
  session: sessionParam(),
  worksheetName: artifactNameParam('worksheet'),
  colors: z
    .array(
      z.object({
        member: z.string().describe('Member value; true or false for a boolean field.'),
        color: z.string().describe('Hex color, #rrggbb.'),
      }),
    )
    .min(1)
    .max(100)
    .describe('Members and the color for each.'),
  field: z
    .string()
    .optional()
    .describe(
      'Name or caption of the field on Color; needed only when panes color different fields.',
    ),
};

type SetMemberColorsResult = {
  message: string;
  field: string;
  datasource: string;
  colors: Array<{ member: string; color: string }>;
};

const title = 'Set Member Colors';
export const getSetMemberColorsTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'set-member-colors',
    title,
    description: "Set colors for members of the discrete field on a worksheet's Color.",
    paramsSchema,
    minApiVersion: '0.2.10',
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    callback: async ({ session, worksheetName, colors, field }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute<SetMemberColorsResult>({
        extra,
        args: { session, worksheetName, colors, field },
        callback: async () => {
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }
          const executor = await extra.getExecutor(sessionResult.value);

          const sheet = await getWorksheetXml({ worksheetName, executor, signal: extra.signal });
          if (sheet.isErr()) {
            const { type, error } = sheet.error;
            if (type === 'get-worksheet-xml-error') {
              return new GetWorksheetXmlFailedError(error).toErr();
            }
            if (type === 'execute-command-error') {
              return isRouteMissing(error)
                ? endpointNotInThisBuild('worksheet document').toErr()
                : new DesktopCommandExecutionError(error).toErr();
            }
            return new UnknownError(error).toErr();
          }

          const resolved = resolveColorTarget(sheet.value.xml, field);
          if (!resolved.ok) {
            return new ArgsValidationError(resolved.message).toErr();
          }
          const { target } = resolved;
          const inventory = await executor.listWorkbookDatasources(extra.signal);
          if (inventory.isErr()) {
            return new DesktopCommandExecutionError(inventory.error).toErr();
          }
          const datasourceId = (inventory.value.datasources ?? []).find(
            (item) => typeof item.id === 'string' && decodedId(item.id) === target.datasource,
          )?.id;
          if (datasourceId === undefined) {
            return new ArgsValidationError(
              `Datasource "${target.datasource}" is not in the workbook.`,
            ).toErr();
          }

          const document = await executor.getDatasourceDocument(datasourceId, extra.signal);
          if (document.isErr()) {
            return isRouteMissing(document.error)
              ? endpointNotInThisBuild('datasource document').toErr()
              : new DesktopCommandExecutionError(document.error).toErr();
          }

          const built = buildBuckets(
            colors,
            target.datatype,
            existingBuckets(document.value.xml, target.instance),
          );
          if (!built.ok) {
            return new ArgsValidationError(built.message).toErr();
          }
          const editedXml = spliceMemberColors(document.value.xml, target, built.buckets);
          if (editedXml === undefined) {
            return new XmlModificationError('The datasource document could not be edited.').toErr();
          }

          const applied = await applyDatasourceXml({
            datasourceId,
            xml: editedXml,
            executor,
            signal: extra.signal,
          });
          if (applied.isErr()) {
            return isRouteMissing(applied.error)
              ? endpointNotInThisBuild('datasource document').toErr()
              : new DesktopCommandExecutionError(applied.error).toErr();
          }

          const verification = await readColorMapsBack({
            appliedXml: editedXml,
            datasourceId,
            executor,
            signal: extra.signal,
          });
          const members = built.buckets.map(({ member }) => member).join(', ');
          if (verification?.status !== 'passed') {
            const retry =
              'The call is safe to repeat. If it fails again, tell the user the colors could not be set.';
            return new XmlModificationError(
              verification?.status === 'failed'
                ? `Desktop accepted the change but the datasource readback does not match. ${verification.message ?? 'The colors are not in the datasource.'} ${retry}`
                : `Sent the colors for ${members} but could not read the datasource back, so they are not confirmed${
                    verification?.message ? ` (${verification.message})` : ''
                  }. Do not tell the user these colors are set. ${retry}`,
            ).toErr();
          }

          const pairs = built.buckets.map(({ member, color }) => ({ member, color }));
          const unmatched = built.buckets
            .filter(({ known }) => known === false)
            .map(({ member }) => member);
          const memberNote =
            unmatched.length > 0
              ? ` ${unmatched.join(', ')} ${unmatched.length === 1 ? 'is' : 'are'} not in the field's current color map, so ${unmatched.length === 1 ? 'it' : 'they'} may not be in the data; ${unmatched.length === 1 ? 'it has' : 'they have'} no effect unless the data has that exact value.`
              : built.buckets.every(({ known }) => known === undefined)
                ? ' A member that is not in the data has no effect.'
                : '';
          const staleFindings = staleWorksheetStyleFindings(
            extractWorksheetStyleColorMaps(sheet.value.xml).filter(
              (map) => map.datasource === target.datasource && map.field === target.instance,
            ),
            (extractColorMaps(editedXml) ?? []).map((map) => ({
              ...map,
              datasource: target.datasource,
            })),
          );
          const stale =
            staleFindings.length === 0
              ? ''
              : ` Note: ${staleFindings.map((finding) => finding.message).join('; ')}. Edit Colors may show those instead.`;
          return new Ok({
            message:
              `Set ${pairs.length} member color(s) for ${target.label} in datasource ${target.datasource}: ` +
              `${pairs.map(({ member, color }) => `${member} -> ${color}`).join('; ')}.` +
              `${formatColorMapCheck(verification)}${memberNote}${stale}`,
            field: target.label,
            datasource: target.datasource,
            colors: pairs,
          });
        },
      });
    },
  });

  return tool;
};
