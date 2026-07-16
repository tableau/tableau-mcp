import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync } from 'fs';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { type FieldResolution, resolveField } from '../../../desktop/metadata/index.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import {
  FileNotFoundError,
  FileReadError,
  XmlModificationError,
} from '../../../errors/mcpToolError.js';
import { log } from '../../../logging/logger.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import { DesktopTool } from '../tool.js';
import { refreshWorkbookCache } from './refreshWorkbookCache.js';

const paramsSchema = {
  workbookFile: z.string().describe('Workbook cache file.'),
  query: z.string().describe('Field reference.'),
  datasource: z.string().optional().describe('Datasource to resolve ambiguity.'),
  session: z
    .string()
    .optional()
    .describe('Session ID; on not_found, refreshes live workbook and retries once.'),
};

interface ResolveFieldResult {
  resolution: FieldResolution;
  isError: boolean;
  /** Optional guidance appended after the resolution JSON (self-heal outcome). */
  note?: string;
}

const title = 'Resolve Field Name to column_ref';
export const getResolveFieldTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const resolveFieldTool = new DesktopTool({
    server,
    name: 'resolve-field',
    title,
    description: [
      'Resolve a free-form field reference to an exact column_ref.',
      'ALWAYS reports ambiguity; DO NOT GUESS. Re-call with datasource or list-available-fields; if still ambiguous, ask-user with candidates.',
      'Use before add-field-* when column_ref did not come from list-available-fields.',
    ].join(' '),
    paramsSchema,
    annotations: {
      title,
      // With session, a not_found triggers a live re-snapshot that rewrites the
      // workbook cache file + sidecar (same as list-available-fields).
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
          if (!existsSync(workbookFile)) {
            return new FileNotFoundError(workbookFile).toErr();
          }

          let workbookXml: string;
          try {
            workbookXml = readFileSync(workbookFile, 'utf-8');
          } catch (error) {
            return new FileReadError(error).toErr();
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
          // datasource" shape. When a session is supplied and nothing matched
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
          let refreshed = false;
          let refreshFailure: string | undefined;
          if (session && resolution.kind === 'not_found') {
            try {
              const sessionResult = resolveSession(session);
              if (sessionResult.isErr()) {
                refreshFailure = sessionResult.error.getErrorText();
              } else {
                const refresh = await refreshWorkbookCache({
                  extra,
                  workbookFile,
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
                data: { workbookFile, sessionId: session, error: refreshFailure },
              });
            }
          }

          const isError = resolution.kind === 'ambiguous' || resolution.kind === 'not_found';

          let note: string | undefined;
          if (refreshed && resolution.kind === 'not_found') {
            note =
              `Refreshed the workbook live from Tableau and "${query}" still does not resolve. ` +
              'The field genuinely does not exist in the CURRENT workbook — stop re-reading stale caches. ' +
              'Call list-available-fields (with session) to see the fields that DO exist, or ask-user to clarify.';
          } else if (refreshFailure && resolution.kind === 'not_found') {
            note =
              `Attempted a live refresh from Tableau to rule out a stale cache, but it failed: ${refreshFailure}\n\n` +
              `This is NOT proof that "${query}" is absent — the live workbook could not be read. ` +
              'Check the session with list-instances (Tableau may have disconnected or restarted), then retry; ' +
              'do not conclude the field is missing from a cache that could not be refreshed.';
          }

          return new Ok<ResolveFieldResult>({ resolution, isError, note });
        },
        getSuccessResult: ({ resolution, isError, note }): CallToolResult => ({
          isError: false,
          content: [
            {
              type: 'text' as const,
              text: `${JSON.stringify({ resolution, isError })}${note ? `\n\n${note}` : ''}`,
            },
          ],
        }),
      });
    },
  });

  return resolveFieldTool;
};
