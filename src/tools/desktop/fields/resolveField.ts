import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync } from 'fs';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { DesktopCache } from '../../../desktop/cache.js';
import { type FieldResolution, resolveField } from '../../../desktop/metadata/index.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import {
  FileNotFoundError,
  FileReadError,
  UnknownError,
  XmlModificationError,
} from '../../../errors/mcpToolError.js';
import { log } from '../../../logging/logger.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import { DesktopTool } from '../tool.js';
import { refreshWorkbookCache } from './refreshWorkbookCache.js';

// A bare `query` / `datasource` / `session` left the agent guessing what to send here; the
// same guessing sent a sheet name as workbookFile on the sibling tools. Each value that
// comes from another call names that call.
const paramsSchema = {
  workbookFile: z
    .string()
    .optional()
    .describe('Cached workbook path returned by field resolution; omit to read the workbook live.'),
  query: z.string().describe('Field name to resolve, as the user said it.'),
  datasource: z
    .string()
    .optional()
    .describe('Existing datasource name used when multiple datasources share a field name.'),
  session: z
    .string()
    .optional()
    .describe('Desktop process ID; omit to use the pinned or only running instance.'),
};

interface ResolveFieldResult {
  resolution: FieldResolution;
  status: 'resolved' | 'ambiguous' | 'not_found' | 'stale_not_found';
  /** The cache file this resolve read. Pass it back as workbookFile to reuse the snapshot. */
  workbookFile: string;
  /**
   * @deprecated Kept for existing consumers that still falsy-check the JSON body.
   * Remove after callers migrate to `status`; keep true for ambiguous/not_found/error statuses.
   */
  isError: boolean;
  stale?: true;
  /** Optional guidance included in the JSON body (self-heal outcome). */
  note?: string;
}

const title = 'Resolve Field Name to column_ref';
export const getResolveFieldTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const resolveFieldTool = new DesktopTool({
    server,
    name: 'resolve-field',
    title,
    description:
      'Disambiguate a field name to its exact column ref (the Country-vs-Country1 class).',
    paramsSchema,
    annotations: {
      title,
      // A cached not_found triggers a live re-snapshot that rewrites the
      // workbook cache file + sidecar.
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async (
      { workbookFile, query, datasource, session },
      extra,
    ): Promise<CallToolResult> => {
      return await resolveFieldTool.logAndExecute({
        extra,
        args: { workbookFile, query, datasource, session },
        callback: async () => {
          // workbookFile is a CACHE PATH minted by an earlier call, not a name. Every
          // bad value production sent was a bare worksheet/workbook name ("Sheet 1",
          // "current", "live", "") — never a stale path — so the class disappears once
          // the parameter can be omitted and the tool fetches the current workbook
          // itself. Empty/whitespace counts as omitted: it is not a path by any reading.
          const requestedWorkbookFile = workbookFile?.trim() ? workbookFile.trim() : undefined;

          let resolvedWorkbookFile: string;
          let workbookXml: string;

          if (requestedWorkbookFile === undefined) {
            const sessionResult = resolveSession(session);
            if (sessionResult.isErr()) {
              return sessionResult.error.toErr();
            }
            resolvedWorkbookFile = new DesktopCache().getCacheFilePath({ prefix: 'workbook' });
            let refresh: Awaited<ReturnType<typeof refreshWorkbookCache>>;
            try {
              refresh = await refreshWorkbookCache({
                extra,
                workbookFile: resolvedWorkbookFile,
                resolvedSession: sessionResult.value,
                action: 'resolving field',
              });
            } catch (error) {
              return new UnknownError(
                `Could not read the current workbook from Tableau: ${getExceptionMessage(error)}. ` +
                  'Check the session with list-instances, then retry.',
              ).toErr();
            }
            if (!refresh.ok) {
              return refresh.error.toErr();
            }
            workbookXml = refresh.xml;
          } else {
            resolvedWorkbookFile = requestedWorkbookFile;
            if (!existsSync(resolvedWorkbookFile)) {
              return new FileNotFoundError(resolvedWorkbookFile).toErr();
            }
            try {
              workbookXml = readFileSync(resolvedWorkbookFile, 'utf-8');
            } catch (error) {
              return new FileReadError(error).toErr();
            }
          }

          let resolution: FieldResolution;
          try {
            resolution = resolveField(workbookXml, query, { datasource });
          } catch (error) {
            return new XmlModificationError(
              error instanceof Error ? error.message : String(error),
            ).toErr();
          }

          // W-23447478: a field/datasource connected AFTER the cache was written is
          // invisible to a cache-only resolve — the P0 "agent doesn't recognize my
          // datasource" shape. When a cached lookup finds nothing
          // (kind:"not_found" — also covers the empty-cache "workbook has no
          // datasources" / "no fields" variants), re-snapshot the live workbook
          // ONCE and retry via the shared refreshWorkbookCache helper (identical
          // path to list-available-fields) so a mid-session datasource connection
          // self-heals. Retry is bounded to one refresh (no loop).
          //
          // P1: a refresh FAILURE here must NOT escape as an MCP tool_error. Whether
          // the helper returns an explicit failure or the underlying getWorkbookXml
          // REJECTS, degrade to the ORIGINAL not_found resolution, annotate it with
          // the reason + next action, and return it as a normal result — so consumers
          // parsing the resolution JSON keep working and no outcome is dropped.
          // (list-available-fields deliberately keeps its throw-on-reject behavior —
          // only THIS retry path degrades.)
          //
          // When workbookFile was omitted the XML above IS the live workbook, so the
          // retry is already spent: count it as refreshed (the not_found note below is
          // then the honest "it genuinely does not exist" one) and never fetch twice.
          let refreshed = requestedWorkbookFile === undefined;
          let refreshFailure: string | undefined;
          if (!refreshed && resolution.kind === 'not_found') {
            try {
              const sessionResult = resolveSession(session);
              if (sessionResult.isErr()) {
                refreshFailure = sessionResult.error.getErrorText();
              } else {
                const refresh = await refreshWorkbookCache({
                  extra,
                  workbookFile: resolvedWorkbookFile,
                  resolvedSession: sessionResult.value,
                  action: 'resolving field',
                });
                if (refresh.ok) {
                  refreshed = true;
                  workbookXml = refresh.xml;
                  resolution = resolveField(workbookXml, query, { datasource });
                } else {
                  refreshFailure = refresh.reason;
                }
              }
            } catch (error) {
              refreshFailure = getExceptionMessage(error);
              log({
                message: 'resolve-field live refresh failed; degrading to cache not_found',
                level: 'warning',
                logger: 'resolveField',
                data: {
                  workbookFile: resolvedWorkbookFile,
                  sessionId: session,
                  error: refreshFailure,
                },
              });
            }
          }

          let note: string | undefined;
          let stale: true | undefined;
          if (refreshed && resolution.kind === 'not_found') {
            note =
              `Refreshed the workbook live from Tableau and "${query}" still does not resolve. ` +
              'The field genuinely does not exist in the CURRENT workbook — stop re-reading stale caches. ' +
              'Call list-available-fields (with session) to see the fields that DO exist, or ask-user to clarify.';
          } else if (refreshFailure && resolution.kind === 'not_found') {
            stale = true;
            note =
              `Attempted a live refresh from Tableau to rule out a stale cache, but it failed: ${refreshFailure}\n\n` +
              `This stale cache result is NOT proof that "${query}" is absent — the live workbook could not be read. ` +
              'Check the session with list-instances (Tableau may have disconnected or restarted), then retry; ' +
              'do not conclude the field is missing from a cache that could not be refreshed.';
          }

          const status = getResolutionStatus(resolution, stale);
          return new Ok<ResolveFieldResult>({
            resolution,
            status,
            workbookFile: resolvedWorkbookFile,
            isError: isResolutionStatusError(status),
            ...(stale ? { stale } : {}),
            ...(note ? { note } : {}),
          });
        },
        getSuccessResult: (result): CallToolResult => ({
          isError: false,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result),
            },
          ],
        }),
      });
    },
  });

  return resolveFieldTool;
};

function getResolutionStatus(
  resolution: FieldResolution,
  stale: true | undefined,
): ResolveFieldResult['status'] {
  if (resolution.kind === 'exact') {
    return 'resolved';
  }
  if (resolution.kind === 'ambiguous') {
    return 'ambiguous';
  }
  return stale ? 'stale_not_found' : 'not_found';
}

function isResolutionStatusError(status: ResolveFieldResult['status']): boolean {
  return status !== 'resolved';
}
