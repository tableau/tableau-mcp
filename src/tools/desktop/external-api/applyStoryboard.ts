import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync } from 'fs';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { checkSidecar } from '../../../desktop/commands/workbook/cacheFingerprint.js';
import { loadStoryboardXml } from '../../../desktop/commands/workbook/loadDashboardXml.js';
import { currentEpisodeId, emitEpisodeEvent } from '../../../desktop/episode-events.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import { formatDashboardPromiseCheck } from '../../../desktop/validation/promise-check.js';
import {
  ArgsValidationError,
  CacheSessionMismatchError,
  DesktopCommandExecutionError,
  FileReadError,
  StoryboardXmlLoadFailedError,
  WorkbookNotFoundError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: z.string().optional(),
  storyboardName: z.string(),
  storyboardFile: z.string().optional(),
};

const title = 'Apply Storyboard';
export const getApplyStoryboardTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const applyStoryboardTool = new DesktopTool({
    server,
    name: 'apply-storyboard',
    title,
    description: 'Apply modified storyboard document to Tableau.',
    paramsSchema,
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
    callback: async (
      { session, storyboardName, storyboardFile },
      extra,
    ): Promise<CallToolResult> => {
      return await applyStoryboardTool.logAndExecute({
        extra,
        args: { session, storyboardName, storyboardFile },
        callback: async () => {
          // No inline document parameter: the cached file path IS the handle. Inline content
          // carries no cache fingerprint, so it would also skip the cross-instance bleed guard below.
          if (!storyboardFile?.trim()) {
            return new ArgsValidationError(
              [
                'A non-empty storyboard file path is required.',
                'Use a cached storyboard path, edit it with read-cached-xml and',
                'write-cached-xml, then pass that path here.',
              ].join(' '),
            ).toErr();
          }

          if (!existsSync(storyboardFile)) {
            return new WorkbookNotFoundError(
              [
                `Cached storyboard file not found: ${storyboardFile}`,
                'Provide an existing cached storyboard path.',
              ].join(' '),
            ).toErr();
          }

          let storyboardXml: string;
          try {
            storyboardXml = readFileSync(storyboardFile, 'utf-8');
          } catch (error) {
            return new FileReadError(error).toErr();
          }

          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }
          const resolvedSession = sessionResult.value;

          // Cross-instance cache-bleed guard (W9): refuse a cache file produced by a
          // different (or restarted) Desktop session before applying it.
          const sidecar = checkSidecar(storyboardFile, resolvedSession, 'storyboard');
          if (!sidecar.ok) {
            return new CacheSessionMismatchError(sidecar.message!).toErr();
          }

          const executor = await extra.getExecutor(resolvedSession);
          const result = await loadStoryboardXml({
            storyboardName,
            xml: storyboardXml,
            focus: { navigate: 'artifact', sheetName: storyboardName },
            executor,
            signal: extra.signal,
            // apply-storyboard updates an existing storyboard in place via the per-sheet `/document`
            // route; a name that does not resolve surfaces as an error rather than creating a
            // storyboard through the whole-workbook path.
            requireExistingSheet: true,
          });

          if (result.isErr()) {
            const { type, error } = result.error;
            switch (type) {
              case 'execute-command-error':
                return new DesktopCommandExecutionError(error).toErr();
              case 'load-dashboard-xml-error':
                return new StoryboardXmlLoadFailedError(error).toErr();
              default: {
                const _: never = type;
              }
            }
          }

          // Host verification receipt (W-23447506): storyboard applies have no structural
          // readback, so say so honestly instead of implying full re-verification happened.
          const receipt = result.isOk()
            ? formatDashboardPromiseCheck(result.value.validationWarnings)
            : '';
          if (result.isOk()) {
            await emitEpisodeEvent(extra.config, {
              type: 'apply_succeeded',
              session_id: resolvedSession,
              episode_id: currentEpisodeId(resolvedSession),
              tool: 'apply-storyboard',
              operation: 'load-storyboard',
              promise_outcome: 'unverified',
            });
          }

          return new Ok({
            message: `Successfully applied storyboard update for "${storyboardName}". The storyboard has been updated.${receipt}`,
          });
        },
      });
    },
  });

  return applyStoryboardTool;
};
