import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { getWorkbookXml } from '../../../desktop/commands/workbook/getWorkbookXml.js';
import { applyWorkbookText } from '../../../desktop/commands/workbook/loadWorkbookXml.js';
import { pollReadback } from '../../../desktop/commands/workbook/pollReadback.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import { validateWorkbookDocumentApply } from '../../../desktop/workbookDocumentGuard.js';
import {
  ArgsValidationError,
  DesktopCommandExecutionError,
  XmlModificationError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const endSchema = z.enum(['top', 'bottom']);
const modeSchema = z.enum(['top-n', 'empty']);

// Primitives in, groupfilter XML server-side, readback out. Authors either an
// initially empty set or a computed Top/Bottom-N set on a dimension; the Top-N
// shape retains its provenance from the WW2021W44 golden workbook.
const paramsSchema = {
  session: z.string().optional().describe(''),
  mode: modeSchema.default('top-n').describe(''),
  caption: z.string().describe(''),
  dimension: z.string().describe(''),
  orderBy: z.string().optional().describe(''),
  count: z.string().optional().describe(''),
  end: endSchema.default('top').describe(''),
  datasource: z.string().optional().describe(''),
};

type DatasourceElement = {
  name: string;
  openStart: number;
  openEnd: number;
  closeStart: number;
  closeEnd: number;
  xml: string;
  selfClosing: boolean;
};

type AuthorSetResult = {
  setName: string;
  caption: string;
  datasource: string;
  hint: string;
};

const title = 'Author Set';
export const getAuthorSetTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'author-set',
    title,
    description: 'Author set.',
    paramsSchema,
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    callback: async (
      { session, mode = 'top-n', caption, dimension, orderBy, count, end = 'top', datasource },
      extra,
    ): Promise<CallToolResult> => {
      return await tool.logAndExecute<AuthorSetResult>({
        extra,
        args: { session, mode, caption, dimension, orderBy, count, end, datasource },
        callback: async () => {
          if (caption.trim().length === 0) {
            return new ArgsValidationError('caption empty').toErr();
          }
          if (dimension.trim().length === 0) {
            return new ArgsValidationError('dimension empty').toErr();
          }
          if (mode === 'empty' && (orderBy !== undefined || count !== undefined)) {
            return new ArgsValidationError(
              'orderBy and count cannot be supplied in empty mode',
            ).toErr();
          }

          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }

          const executor = await extra.getExecutor(sessionResult.value);
          const readResult = await getWorkbookXml({ executor, signal: extra.signal });
          if (readResult.isErr()) {
            return new DesktopCommandExecutionError(readResult.error).toErr();
          }

          const liveXml = readResult.value;
          const targetResult = selectTargetDatasource(liveXml, datasource);
          if (targetResult.isErr()) {
            return targetResult.error.toErr();
          }
          const target = targetResult.value;

          if (hasGroupCaption(target.xml, caption)) {
            return new ArgsValidationError(
              'caption collision — pick a new caption or use the existing set',
            ).toErr();
          }

          const setName = `[${caption}]`;
          let groupXml: string;
          if (mode === 'top-n') {
            if (orderBy === undefined || orderBy.trim().length === 0) {
              return new ArgsValidationError('orderBy is required in top-n mode').toErr();
            }
            if (count === undefined || count.trim().length === 0) {
              return new ArgsValidationError('count is required in top-n mode').toErr();
            }
            const trimmedCount = count.trim();
            const isParameterReference = /^\[Parameters\]\.\[[^\]]+\]$/.test(trimmedCount);
            // Parameter references are write-blind: their live value is not validated here.
            // Literal counts must be positive integers before the workbook is written.
            if (!isParameterReference && !/^[1-9]\d*$/.test(trimmedCount)) {
              return new ArgsValidationError(
                'count must be a positive integer in top-n mode',
              ).toErr();
            }
            groupXml = renderTopNGroupSet({
              caption,
              setName,
              dimension,
              orderBy,
              count,
              end,
            });
          } else {
            groupXml = renderEmptyGroupSet({ caption, setName, dimension });
          }
          const editedXml = spliceElementIntoDatasource(liveXml, target, groupXml);
          const validation = validateWorkbookDocumentApply(editedXml, liveXml);
          if (!validation.ok) {
            return new ArgsValidationError(validation.message).toErr();
          }

          const loadResult = await applyWorkbookText({
            xml: editedXml,
            focus: { navigate: 'restore' },
            executor,
            signal: extra.signal,
          });
          if (loadResult.isErr()) {
            return new DesktopCommandExecutionError(loadResult.error).toErr();
          }

          const findReadbackGroup = (xml: string): string | undefined => {
            const readbackTarget = findDatasourceElements(xml).find(
              (datasource) => datasource.name === target.name,
            );
            return readbackTarget === undefined
              ? undefined
              : findGroupByNameAndCaption(readbackTarget.xml, setName, caption);
          };
          const readback = await pollReadback({
            read: () => getWorkbookXml({ executor, signal: extra.signal }),
            settled: (xml) => {
              const group = findReadbackGroup(xml);
              return group !== undefined && getAttr(group, 'user:ui-builder') === 'filter-group';
            },
            signal: extra.signal,
          });
          if (!readback.ok) {
            return new DesktopCommandExecutionError(readback.error).toErr();
          }
          if (!readback.settled) {
            return new XmlModificationError(
              findReadbackGroup(readback.value) === undefined
                ? 'load completed but did not apply: readback did not contain the new set name and caption'
                : "load completed and the set name and caption survived readback, but the user:ui-builder='filter-group' marker did not survive readback",
            ).toErr();
          }

          return new Ok({
            setName,
            caption,
            datasource: target.name,
            hint: 'reference it by caption in a build-worksheets-from-templates fieldMapping, or as a filter/color field',
          });
        },
      });
    },
  });

  return tool;
};

function selectTargetDatasource(
  xml: string,
  requested: string | undefined,
): Result<DatasourceElement, ArgsValidationError> {
  const datasources = findDatasourceElements(xml);
  const candidates = datasources.filter((datasource) => datasource.name !== 'Parameters');
  if (requested !== undefined) {
    const selected = candidates.find((datasource) => datasource.name === requested);
    if (selected) {
      return new Ok(selected);
    }
    return new ArgsValidationError(
      `Datasource "${requested}" was not found. Candidates: ${candidates.map((d) => d.name).join(', ')}`,
    ).toErr();
  }
  if (candidates.length === 1) {
    return new Ok(candidates[0]);
  }
  if (candidates.length === 0) {
    return new ArgsValidationError('No non-Parameters datasource found.').toErr();
  }
  return new ArgsValidationError(
    `Multiple datasources found; specify datasource. Candidates: ${candidates.map((d) => d.name).join(', ')}`,
  ).toErr();
}

function findDatasourceElements(xml: string): DatasourceElement[] {
  const elements: DatasourceElement[] = [];
  // Only the top-level <datasources> block holds the real ones; worksheet
  // <dependencies> clone <datasource name='...'> and splicing into a clone is
  // silently discarded by Tableau (author-calc lesson, 2026-07-19).
  const blockStart = xml.indexOf('<datasources>');
  const blockEnd = xml.indexOf('</datasources>', blockStart);
  const scanFrom = blockStart === -1 ? 0 : blockStart;
  const scanTo = blockEnd === -1 ? xml.length : blockEnd;
  const openTagRe = /<datasource\b[^>]*(?:\/>|>)/g;
  for (const match of xml.matchAll(openTagRe)) {
    if (match.index < scanFrom || match.index >= scanTo) {
      continue;
    }
    const openTag = match[0];
    const openStart = match.index;
    const openEnd = openStart + openTag.length;
    const name = getAttr(openTag, 'name');
    if (name === undefined) {
      continue;
    }
    const selfClosing = /\/\s*>$/.test(openTag);
    if (selfClosing) {
      elements.push({
        name: unescapeXml(name),
        openStart,
        openEnd,
        closeStart: openEnd,
        closeEnd: openEnd,
        xml: openTag,
        selfClosing,
      });
      continue;
    }
    const closeStart = xml.indexOf('</datasource>', openEnd);
    if (closeStart === -1) {
      continue;
    }
    const closeEnd = closeStart + '</datasource>'.length;
    elements.push({
      name: unescapeXml(name),
      openStart,
      openEnd,
      closeStart,
      closeEnd,
      xml: xml.slice(openStart, closeEnd),
      selfClosing,
    });
  }
  return elements;
}

function hasGroupCaption(datasourceXml: string, caption: string): boolean {
  return findGroupTags(datasourceXml).some(
    (tag) => unescapeXml(getAttr(tag, 'caption') ?? '') === caption,
  );
}

function findGroupByNameAndCaption(xml: string, name: string, caption: string): string | undefined {
  return findGroupTags(xml).find(
    (tag) =>
      unescapeXml(getAttr(tag, 'name') ?? '') === name &&
      unescapeXml(getAttr(tag, 'caption') ?? '') === caption,
  );
}

function findGroupTags(xml: string): string[] {
  // Only the group OPEN tag is needed for name/caption checks.
  return [...xml.matchAll(/<group\b[^>]*>/g)].map((match) => match[0]);
}

function bracketize(token: string): string {
  const trimmed = token.trim();
  // Already a reference like [Parameters].[Parameter 3] or [Sub-Category] — pass through.
  if (trimmed.startsWith('[')) {
    return trimmed;
  }
  return `[${trimmed}]`;
}

function renderTopNGroupSet({
  caption,
  setName,
  dimension,
  orderBy,
  count,
  end,
}: {
  caption: string;
  setName: string;
  dimension: string;
  orderBy: string;
  count: string;
  end: z.infer<typeof endSchema>;
}): string {
  const level = bracketize(dimension);
  // count is a literal integer or a parameter reference token — emit verbatim
  // (Tableau resolves [Parameters].[X] at runtime; a bare integer is a fixed N).
  return (
    `<group caption='${escapeXml(caption)}' name='${escapeXml(setName)}' name-style='unqualified' user:ui-builder='filter-group'>` +
    `<groupfilter count='${escapeXml(count.trim())}' end='${end}' function='end' units='records' user:ui-marker='end' user:ui-top-by-field='true'>` +
    `<groupfilter direction='DESC' expression='${escapeXml(orderBy)}' function='order' user:ui-marker='order'>` +
    `<groupfilter function='level-members' level='${escapeXml(level)}' user:ui-enumeration='all' user:ui-marker='enumerate' />` +
    '</groupfilter></groupfilter></group>'
  );
}

function renderEmptyGroupSet({
  caption,
  setName,
  dimension,
}: {
  caption: string;
  setName: string;
  dimension: string;
}): string {
  return (
    `<group caption='${escapeXml(caption)}' name='${escapeXml(setName)}' name-style='unqualified' user:ui-builder='filter-group'>` +
    `<groupfilter function='empty-level' member='${escapeXml(bracketize(dimension))}' user:ui-domain='database' user:ui-enumeration='inclusive' user:ui-marker='enumerate' />` +
    '</group>'
  );
}

function spliceElementIntoDatasource(
  xml: string,
  datasource: DatasourceElement,
  elementXml: string,
): string {
  if (datasource.selfClosing) {
    const openTag = xml.slice(datasource.openStart, datasource.openEnd).replace(/\/\s*>$/, '>');
    return `${xml.slice(0, datasource.openStart)}${openTag}${elementXml}</datasource>${xml.slice(
      datasource.openEnd,
    )}`;
  }

  // Insert at the datasource END — the position every successful live splice used
  // (author-calc lesson: relation/columns blocks are a position trap).
  return `${xml.slice(0, datasource.closeStart)}${elementXml}${xml.slice(datasource.closeStart)}`;
}

function getAttr(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`\\b${name}=(['"])(.*?)\\1`));
  return match?.[2];
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll("'", '&apos;')
    .replaceAll('"', '&quot;');
}

function unescapeXml(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&amp;', '&');
}
