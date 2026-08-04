import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { writeFileSync } from 'fs';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { formatArtifactSummary } from '../../../desktop/artifactSummary.js';
import { DesktopCache } from '../../../desktop/cache.js';
import { writeSidecar } from '../../../desktop/commands/workbook/cacheFingerprint.js';
import {
  buildInlineCapFileMessage,
  isOverInlineXmlCap,
  logInlineXmlCapHit,
  xmlByteLength,
} from '../../../desktop/inlineXmlCap.js';
import { parseXML } from '../../../desktop/metadata/parser.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import { DesktopCommandExecutionError, UnknownError } from '../../../errors/mcpToolError.js';
import { log } from '../../../logging/logger.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';
import {
  endpointNotInThisBuild,
  isRouteMissing,
  resolveItemByNameOrId,
} from './externalApiToolUtils.js';

const paramsSchema = {
  session: z.string().optional().describe('Session ID; optional if pinned or unique.'),
  storyboard: z.string().describe('Storyboard name/id.'),
  mode: z.enum(['file', 'inline']).optional().default('file'),
};
const title = 'Get Storyboard Document';

type InlineResult = { storyboardXml: string };
type FileResult = { file: string; instructions: string };
type GetStoryboardXmlToolResult = { message: string } & (InlineResult | FileResult);

export const getStoryboardXmlTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const getStoryboardXml = new DesktopTool({
    server,
    name: 'get-storyboard-xml',
    title,
    description: 'Return one storyboard document subtree.',
    paramsSchema,
    annotations: {
      readOnlyHint: false, // Writes to a cache file
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    callback: async ({ session, storyboard, mode }, extra): Promise<CallToolResult> => {
      return await getStoryboardXml.logAndExecute<GetStoryboardXmlToolResult>({
        extra,
        args: { session, storyboard, mode },
        callback: async () => {
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }
          const resolvedSession = sessionResult.value;
          const executor = await extra.getExecutor(resolvedSession);

          // A storyboard serializes as a `<dashboard type='storyboard'>`, and its `/document` route
          // returns that bare fragment directly. Resolve the name to an id, then fetch the document.
          const listResult = await executor.listStoryboards(extra.signal);
          if (listResult.isErr()) {
            if (isRouteMissing(listResult.error)) {
              return endpointNotInThisBuild('storyboard list').toErr();
            }
            return new DesktopCommandExecutionError(listResult.error).toErr();
          }

          const storyboardResult = resolveItemByNameOrId(
            'Storyboard',
            storyboard,
            listResult.value.storyboards ?? [],
          );
          if (storyboardResult.isErr()) {
            return storyboardResult.error.toErr();
          }
          const resolved = storyboardResult.value;

          const documentResult = await executor.getStoryboardDocument(resolved.id, extra.signal);
          if (documentResult.isErr()) {
            if (isRouteMissing(documentResult.error)) {
              return endpointNotInThisBuild('storyboard document').toErr();
            }
            return new DesktopCommandExecutionError(documentResult.error).toErr();
          }

          const storyboardXml = documentResult.value.xml;
          if (!parseXML(storyboardXml).dashboard) {
            return new UnknownError(
              `No storyboard document subtree found for "${storyboard}".`,
            ).toErr();
          }

          const bytes = xmlByteLength(storyboardXml);
          const capBytes = extra.config.inlineXmlMaxBytes;
          const capFired = mode === 'inline' && isOverInlineXmlCap(bytes, capBytes);

          if (mode === 'inline' && !capFired) {
            return new Ok({
              message: `Storyboard document returned inline (${bytes} bytes)`,
              storyboardXml,
            });
          }

          const safeName = resolved.name.replace(/[^a-zA-Z0-9]/g, '_');
          const cacheFile = new DesktopCache().getCacheFilePath({
            prefix: `storyboard-${safeName}`,
          });
          writeFileSync(cacheFile, storyboardXml, 'utf-8');
          // Stamp the producing session so apply-storyboard can refuse a cache from a
          // different (or restarted) Desktop instance — cross-instance bleed guard (W9).
          writeSidecar(cacheFile, resolvedSession);

          if (capFired) {
            logInlineXmlCapHit({ tool: 'get-storyboard-xml', bytes, capBytes, file: cacheFile });
            return Ok({
              message: buildInlineCapFileMessage({
                // A storyboard has no dedicated ArtifactKind; it shares the dashboard summary shape.
                kind: 'dashboard',
                label: `Storyboard "${resolved.name}"`,
                bytes,
                capBytes,
                xml: storyboardXml,
                applyTool: 'apply-storyboard',
                pathParam: 'storyboardFile',
              }),
              file: cacheFile,
              instructions:
                'This storyboard exceeds the inline cap. Use the cache read tool (with a dashboard ' +
                'selector or startByte/endByte to read a slice), the cache write tool (same selector to ' +
                'splice edits back), then call apply-storyboard with storyboardFile set to this file path.',
            });
          }

          log({
            message: `Saved storyboard document to cache file: ${cacheFile}`,
            level: 'info',
            logger: 'tool',
            data: { file: cacheFile, size: bytes },
          });

          return Ok({
            message: `Storyboard "${resolved.name}" saved to cache file (${bytes} bytes)\n\nArtifact summary:\n${formatArtifactSummary('dashboard', storyboardXml)}`,
            file: cacheFile,
            instructions:
              'Use this file path with apply-storyboard instead of passing content directly.',
          });
        },
      });
    },
  });

  return getStoryboardXml;
};
