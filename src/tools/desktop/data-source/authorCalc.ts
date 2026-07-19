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
          // Layered calcs reference siblings by CAPTION, but Tableau formulas
          // resolve internal names — and authored calcs get [Calculation_N]
          // names the agent cannot know (live: 5 of 6 calcs red-! broken,
          // 2026-07-19). Rewrite bracketed caption tokens to internal names.
          const resolvedFormula = resolveCaptionReferences(formula, target.xml, liveXml);
          const columnXml = renderCalculationColumn({
            caption,
            formula: resolvedFormula,
            role,
            datatype,
            calcName,
          });
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
  // Worksheet <dependencies> blocks clone <datasource name='...'> elements —
  // splicing into a clone is silently discarded by Tableau (live, 2026-07-19).
  // Only the top-level <datasources> block holds the real ones.
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

export { resolveCaptionReferences as resolveCaptionReferencesForTest };

function resolveCaptionReferences(
  formula: string,
  datasourceXml: string,
  workbookXml?: string,
): string {
  const captionToRef = new Map<string, string>();
  for (const tag of findColumnTags(datasourceXml)) {
    const cap = getAttr(tag, 'caption');
    const name = getAttr(tag, 'name');
    if (cap === undefined || name === undefined) continue;
    const capText = unescapeXml(cap);
    const nameText = unescapeXml(name).replace(/^\[|\]$/g, '');
    if (capText !== nameText) {
      captionToRef.set(capText, `[${nameText}]`);
    }
  }
  // Parameters live in their OWN datasource, not the target's — a formula that
  // names one by caption must resolve to the QUALIFIED [Parameters].[Parameter N]
  // form or the calc silently fails to bind (live: verse-3 empty sheet,
  // 2026-07-19 — the filter calc referenced two parameter captions unresolved).
  // Set after the field map so a caption collision resolves to the parameter,
  // which is what a dynamic-ask formula means.
  if (workbookXml !== undefined) {
    const paramsDs = parametersDatasourceBlock(workbookXml);
    if (paramsDs !== undefined) {
      for (const tag of findColumnTags(paramsDs)) {
        const cap = getAttr(tag, 'caption');
        const name = getAttr(tag, 'name');
        if (cap === undefined || name === undefined) continue;
        captionToRef.set(unescapeXml(cap), `[Parameters].${unescapeXml(name)}`);
      }
    }
  }
  if (captionToRef.size === 0) return formula;
  // Bracketed tokens only; captions containing ']' and bracket-like text inside
  // string literals are out of scope for this pass.
  return formula.replace(/\[([^\]]+)\]/g, (whole, token: string) => {
    return captionToRef.get(token) ?? whole;
  });
}

function parametersDatasourceBlock(xml: string): string | undefined {
  const open = /<datasource\b[^>]*\bname=(['"])Parameters\1[^>]*>/.exec(xml);
  if (!open || open.index === undefined) return undefined;
  const close = xml.indexOf('</datasource>', open.index);
  return close === -1 ? undefined : xml.slice(open.index, close + '</datasource>'.length);
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

  // Always insert at the datasource END: "after the last <column>" is a trap —
  // <connection>/<relation>/<columns> holds schema <column ordinal=.../> nodes,
  // and a calc spliced inside the relation block is silently discarded by
  // Tableau (live, 2026-07-19). End-of-datasource is the position every
  // successful live splice used.
  return `${xml.slice(0, datasource.closeStart)}${columnXml}${xml.slice(datasource.closeStart)}`;
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
