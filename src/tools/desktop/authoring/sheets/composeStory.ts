import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { escapeXml } from '../../../../desktop/binder/escape.js';
import { resolveItemByNameOrId } from '../../../../desktop/externalApi/toolUtils.js';
import { resolveSession } from '../../../../desktop/session/sessionResolution.js';
import {
  introducedBlockingValidationIssues,
  runValidation,
} from '../../../../desktop/validation/registry.js';
import { withApplyLock } from '../../../../desktop/wrappers/applyMutex.js';
import { sourceSha256 } from '../../../../desktop/wrappers/cacheFingerprint.js';
import { pollReadback } from '../../../../desktop/wrappers/pollReadback.js';
import {
  ArgsValidationError,
  DesktopCommandExecutionError,
  XmlModificationError,
} from '../../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import { sessionParam } from '../../params.js';
import { DesktopTool } from '../../tool.js';

const pointSchema = z.object({
  dashboard: z.string().trim().min(1).max(255),
  caption: z.string().trim().min(1).max(80).optional(),
});

const paramsSchema = {
  session: sessionParam(),
  storyboard: z.string().trim().min(1).max(255).describe('Existing story name or id.'),
  points: z.array(pointSchema).min(1).max(12),
  replaceExisting: z.boolean().optional(),
};

type StoryPoint = z.infer<typeof pointSchema>;
type StorySize = { width: number; height: number };

export type ComposeStoryDocumentResult = { ok: true; xml: string } | { ok: false; message: string };

const title = 'Compose story';

export const getComposeStoryTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'compose-story',
    title,
    description: 'Set ordered story points at one fixed size.',
    paramsSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async (
      { session, storyboard, points, replaceExisting = false },
      extra,
    ): Promise<CallToolResult> => {
      return await tool.logAndExecute({
        extra,
        args: { session, storyboard, points, replaceExisting },
        callback: async () => {
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) return sessionResult.error.toErr();
          const executor = await extra.getExecutor(sessionResult.value);

          const storyboards = await executor.listStoryboards(extra.signal);
          if (storyboards.isErr())
            return new DesktopCommandExecutionError(storyboards.error).toErr();
          const resolvedStory = resolveItemByNameOrId(
            'Storyboard',
            storyboard,
            storyboards.value.storyboards ?? [],
          );
          if (resolvedStory.isErr()) return resolvedStory.error.toErr();

          const dashboards = await executor.listDashboards(extra.signal);
          if (dashboards.isErr()) return new DesktopCommandExecutionError(dashboards.error).toErr();

          const resolvedPoints: StoryPoint[] = [];
          const sizes: StorySize[] = [];
          for (const point of points) {
            const resolved = resolveItemByNameOrId(
              'Dashboard',
              point.dashboard,
              dashboards.value.dashboards ?? [],
            );
            if (resolved.isErr()) return resolved.error.toErr();
            const document = await executor.getDashboardDocument(resolved.value.id, extra.signal);
            if (document.isErr()) {
              return new DesktopCommandExecutionError(document.error).toErr();
            }
            const size = readFixedSize(document.value.xml);
            if (!size) {
              return new ArgsValidationError(
                `Dashboard "${resolved.value.name}" must use a fixed size before it can be added to this story.`,
              ).toErr();
            }
            resolvedPoints.push({
              dashboard: resolved.value.name,
              caption: point.caption ?? resolved.value.name,
            });
            sizes.push(size);
          }

          const dashboardNames = resolvedPoints.map(({ dashboard }) => dashboard);
          if (new Set(dashboardNames).size !== dashboardNames.length) {
            return new ArgsValidationError('Story points must target distinct dashboards.').toErr();
          }
          const size = sizes[0];
          if (sizes.some((candidate) => !sameSize(candidate, size))) {
            return new ArgsValidationError(
              'All story dashboards must use the same fixed size. Resize them consistently, then retry.',
            ).toErr();
          }

          const source = await executor.getStoryboardDocument(resolvedStory.value.id, extra.signal);
          if (source.isErr()) return new DesktopCommandExecutionError(source.error).toErr();
          const composed = composeStoryDocument(source.value.xml, {
            ...size,
            points: resolvedPoints,
          });
          if (!composed.ok) return new ArgsValidationError(composed.message).toErr();
          const alreadyMatches = storyMatches(source.value.xml, composed.xml);
          if (!alreadyMatches && hasPopulatedStoryPoints(source.value.xml) && !replaceExisting) {
            return new ArgsValidationError(
              `Story "${resolvedStory.value.name}" already contains story points. Set replaceExisting only after an explicit rebuild/replace request.`,
            ).toErr();
          }

          const introduced = introducedBlockingValidationIssues(
            runValidation(source.value.xml, 'dashboard').issues,
            runValidation(composed.xml, 'dashboard').issues,
          );
          if (introduced.length > 0) {
            return new ArgsValidationError(
              `The composed story failed preflight: ${introduced.map(({ message }) => message).join(' ')}`,
            ).toErr();
          }

          if (!alreadyMatches) {
            const sourceHash = sourceSha256(source.value.xml);
            const applied = await withApplyLock(async () => {
              const latest = await executor.getStoryboardDocument(
                resolvedStory.value.id,
                extra.signal,
              );
              if (latest.isErr()) return { kind: 'error' as const, error: latest.error };
              if (sourceSha256(latest.value.xml) !== sourceHash) {
                return { kind: 'drift' as const };
              }
              const result = await executor.applyStoryboardDocument(
                resolvedStory.value.id,
                composed.xml,
                extra.signal,
              );
              return result.isErr()
                ? { kind: 'error' as const, error: result.error }
                : { kind: 'applied' as const };
            });
            if (applied.kind === 'error') {
              return new DesktopCommandExecutionError(applied.error).toErr();
            }
            if (applied.kind === 'drift') {
              return new XmlModificationError(
                `Story "${resolvedStory.value.name}" changed during composition. Re-read and retry.`,
              ).toErr();
            }

            const readback = await pollReadback({
              read: async () =>
                await executor.getStoryboardDocument(resolvedStory.value.id, extra.signal),
              settled: ({ xml }) => storyMatches(xml, composed.xml),
              signal: extra.signal,
            });
            if (!readback.ok) return new DesktopCommandExecutionError(readback.error).toErr();
            if (!readback.settled) {
              return new XmlModificationError(
                `Desktop accepted story "${resolvedStory.value.name}", but its points or size did not survive readback.`,
              ).toErr();
            }
          }

          return new Ok({
            storyboard: resolvedStory.value.name,
            size,
            points: resolvedPoints,
            verified: true,
          });
        },
      });
    },
  });
  return tool;
};

export function composeStoryDocument(
  storyboardXml: string,
  request: StorySize & { points: StoryPoint[] },
): ComposeStoryDocumentResult {
  if (!/<dashboard\b[^>]*(?:type|type-v2)=(['"])storyboard\1[^>]*>/i.test(storyboardXml)) {
    return { ok: false, message: 'The target document is not a Tableau storyboard.' };
  }
  const size = /<size\b[^>]*\/?\s*>/.exec(storyboardXml);
  const flipboard = /<flipboard\b[^>]*>/.exec(storyboardXml);
  const storyPoints = /<story-points\b[^>]*>[\s\S]*?<\/story-points>/.exec(storyboardXml);
  if (!size || !flipboard || !storyPoints) {
    return {
      ok: false,
      message: 'The story is missing its Tableau-authored size, flipboard, or story-points node.',
    };
  }

  let nextSize = upsertAttribute(size[0], 'sizing-mode', 'fixed');
  for (const [name, value] of [
    ['maxheight', request.height],
    ['maxwidth', request.width],
    ['minheight', request.height],
    ['minwidth', request.width],
  ] as const) {
    nextSize = upsertAttribute(nextSize, name, String(value));
  }

  let nextFlipboard = flipboard[0];
  for (const [name, value] of [
    ['active-id', '1'],
    ['nav-type', 'caption'],
    ['show-nav-arrows', 'true'],
  ] as const) {
    nextFlipboard = upsertAttribute(nextFlipboard, name, value);
  }

  const renderedPoints = request.points
    .map((point, index) => {
      const caption = point.caption ?? point.dashboard;
      return `<story-point captured-sheet='${escapeXml(point.dashboard)}' caption='${escapeXml(caption)}' id='${index + 1}' />`;
    })
    .join('');
  const nextStoryPoints = `<story-points>${renderedPoints}</story-points>`;

  return {
    ok: true,
    xml: storyboardXml
      .replace(size[0], () => nextSize)
      .replace(flipboard[0], () => nextFlipboard)
      .replace(storyPoints[0], () => nextStoryPoints),
  };
}

function readFixedSize(xml: string): StorySize | undefined {
  const size = /<size\b[^>]*\/?\s*>/.exec(xml)?.[0];
  if (!size) return undefined;
  const sizingMode = readAttribute(size, 'sizing-mode');
  if (sizingMode !== undefined && sizingMode !== 'fixed') return undefined;
  const maxWidth = readIntegerAttribute(size, 'maxwidth');
  const minWidth = readIntegerAttribute(size, 'minwidth');
  const maxHeight = readIntegerAttribute(size, 'maxheight');
  const minHeight = readIntegerAttribute(size, 'minheight');
  if (
    maxWidth === undefined ||
    minWidth === undefined ||
    maxHeight === undefined ||
    minHeight === undefined ||
    maxWidth !== minWidth ||
    maxHeight !== minHeight
  ) {
    return undefined;
  }
  return { width: maxWidth, height: maxHeight };
}

function hasPopulatedStoryPoints(xml: string): boolean {
  const points = /<story-points\b[^>]*>[\s\S]*?<\/story-points>/.exec(xml)?.[0] ?? '';
  return [...points.matchAll(/<story-point\b[^>]*\/?\s*>/g)].some((match) => {
    const dashboard = readAttribute(match[0], 'captured-sheet');
    const caption = readAttribute(match[0], 'caption');
    return dashboard === undefined || dashboard.trim() !== '' || (caption?.trim() ?? '') !== '';
  });
}

function storyMatches(actualXml: string, intendedXml: string): boolean {
  return storySignature(actualXml) === storySignature(intendedXml);
}

function storySignature(xml: string): string {
  const size = readFixedSize(xml);
  const flipboard = /<flipboard\b[^>]*>/.exec(xml)?.[0] ?? '';
  const points = /<story-points\b[^>]*>[\s\S]*?<\/story-points>/.exec(xml)?.[0] ?? '';
  const normalizedPoints = [...points.matchAll(/<story-point\b[^>]*\/?\s*>/g)].map((match) => ({
    id: readAttribute(match[0], 'id'),
    dashboard: readAttribute(match[0], 'captured-sheet'),
    caption: readAttribute(match[0], 'caption'),
  }));
  return JSON.stringify({
    size,
    navigation: {
      activeId: readAttribute(flipboard, 'active-id'),
      navType: readAttribute(flipboard, 'nav-type'),
      showNavArrows: readAttribute(flipboard, 'show-nav-arrows'),
    },
    points: normalizedPoints,
  });
}

function upsertAttribute(tag: string, name: string, value: string): string {
  const pattern = new RegExp(`(\\s${name}\\s*=\\s*)(['"])(.*?)\\2`, 'i');
  if (pattern.test(tag)) return tag.replace(pattern, `$1'${escapeXml(value)}'`);
  return tag.replace(/\s*\/?\s*>$/, (close) => ` ${name}='${escapeXml(value)}'${close}`);
}

function readIntegerAttribute(tag: string, name: string): number | undefined {
  const value = readAttribute(tag, name);
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function readAttribute(tag: string, name: string): string | undefined {
  return new RegExp(`\\b${name}\\s*=\\s*(['"])(.*?)\\1`, 'i').exec(tag)?.[2];
}

function sameSize(left: StorySize, right: StorySize): boolean {
  return left.width === right.width && left.height === right.height;
}
