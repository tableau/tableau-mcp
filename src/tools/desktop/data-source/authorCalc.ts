import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { getWorkbookXml } from '../../../desktop/commands/workbook/getWorkbookXml.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import { validateUnderlyingMetadataLoad } from '../../../desktop/underlyingMetadataGuard.js';
import {
  ArgsValidationError,
  DesktopCommandExecutionError,
  XmlModificationError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const roleSchema = z.enum(['measure', 'dimension']);
const datatypeSchema = z.enum(['real', 'integer', 'string', 'boolean', 'date', 'datetime']);

const paramsSchema = {
  session: z.string().optional().describe(''),
  caption: z.string().describe(''),
  formula: z.string().describe(''),
  role: roleSchema.default('measure').describe(''),
  datatype: datatypeSchema.default('real').describe(''),
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

type Role = z.infer<typeof roleSchema>;
type Datatype = z.infer<typeof datatypeSchema>;

type AuthorCalcResult = {
  calcName: string;
  caption: string;
  datasource: string;
  hint: string;
};

const title = 'Author Calc';
export const getAuthorCalcTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'author-calc',
    title,
    description: 'Author calc.',
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    callback: async (
      { session, caption, formula, role = 'measure', datatype = 'real', datasource },
      extra,
    ): Promise<CallToolResult> => {
      return await tool.logAndExecute<AuthorCalcResult>({
        extra,
        args: { session, caption, formula, role, datatype, datasource },
        callback: async () => {
          if (caption.trim().length === 0) {
            return new ArgsValidationError('caption empty').toErr();
          }
          if (formula.trim().length === 0) {
            return new ArgsValidationError('formula empty').toErr();
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

          if (hasColumnCaption(target.xml, caption)) {
            return new ArgsValidationError(
              'caption collision — pick a new caption or use the existing field',
            ).toErr();
          }

          const calcName = nextCalculationName(liveXml, Date.now());
          const columnXml = renderCalculationColumn({ caption, formula, role, datatype, calcName });
          const editedXml = spliceColumnIntoDatasource(liveXml, target, columnXml);
          const validation = validateUnderlyingMetadataLoad(editedXml, liveXml);
          if (!validation.ok) {
            return new ArgsValidationError(validation.message).toErr();
          }

          const loadResult = await executor.executeCommand({
            namespace: 'tabui',
            command: 'load-underlying-metadata',
            args: { text: editedXml },
            signal: extra.signal,
          });
          if (loadResult.isErr()) {
            return new DesktopCommandExecutionError(loadResult.error).toErr();
          }

          const readbackResult = await getWorkbookXml({ executor, signal: extra.signal });
          if (readbackResult.isErr()) {
            return new DesktopCommandExecutionError(readbackResult.error).toErr();
          }
          if (!hasColumnNameAndCaption(readbackResult.value, calcName, caption)) {
            return new XmlModificationError(
              'load completed but did not apply: readback did not contain the new column name and caption',
            ).toErr();
          }

          return new Ok({
            calcName,
            caption,
            datasource: target.name,
            hint: 'reference it by caption in generate-viz-from-notional-spec',
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
  const openTagRe = /<datasource\b[^>]*(?:\/>|>)/g;
  for (const match of xml.matchAll(openTagRe)) {
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

function hasColumnCaption(datasourceXml: string, caption: string): boolean {
  return findColumnTags(datasourceXml).some(
    (tag) => unescapeXml(getAttr(tag, 'caption') ?? '') === caption,
  );
}

function hasColumnNameAndCaption(xml: string, name: string, caption: string): boolean {
  return findColumnTags(xml).some(
    (tag) =>
      unescapeXml(getAttr(tag, 'name') ?? '') === name &&
      unescapeXml(getAttr(tag, 'caption') ?? '') === caption,
  );
}

function findColumnTags(xml: string): string[] {
  return [...xml.matchAll(/<column\b[\s\S]*?(?:<\/column>|\/>)/g)].map((match) => match[0]);
}

function nextCalculationName(xml: string, epochMillis: number): string {
  const used = new Set(
    [...xml.matchAll(/\bname=(['"])\[Calculation_(\d+)\]\1/g)].map((match) => match[2]),
  );
  let candidate = epochMillis;
  while (used.has(String(candidate))) {
    candidate += 1;
  }
  return `[Calculation_${candidate}]`;
}

function renderCalculationColumn({
  caption,
  datatype,
  formula,
  role,
  calcName,
}: {
  caption: string;
  datatype: Datatype;
  formula: string;
  role: Role;
  calcName: string;
}): string {
  const type =
    role === 'measure' && (datatype === 'real' || datatype === 'integer')
      ? 'quantitative'
      : 'nominal';
  return `<column caption='${escapeXml(caption)}' datatype='${datatype}' name='${escapeXml(calcName)}' role='${role}' type='${type}'><calculation class='tableau' formula='${escapeXml(formula)}' /></column>`;
}

function spliceColumnIntoDatasource(
  xml: string,
  datasource: DatasourceElement,
  columnXml: string,
): string {
  if (datasource.selfClosing) {
    const openTag = xml.slice(datasource.openStart, datasource.openEnd).replace(/\/\s*>$/, '>');
    return `${xml.slice(0, datasource.openStart)}${openTag}${columnXml}</datasource>${xml.slice(
      datasource.openEnd,
    )}`;
  }

  const content = xml.slice(datasource.openEnd, datasource.closeStart);
  const columnMatches = [...content.matchAll(/<column\b[\s\S]*?(?:<\/column>|\/>)/g)];
  const insertAt =
    columnMatches.length > 0
      ? datasource.openEnd +
        columnMatches[columnMatches.length - 1].index +
        columnMatches[columnMatches.length - 1][0].length
      : datasource.closeStart;
  return `${xml.slice(0, insertAt)}${columnXml}${xml.slice(insertAt)}`;
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
