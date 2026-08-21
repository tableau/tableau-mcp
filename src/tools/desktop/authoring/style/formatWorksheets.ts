import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { resolveItemByNameOrId } from '../../../../desktop/externalApi/toolUtils.js';
import { parseCanonicalColumnRef } from '../../../../desktop/metadata/field-resolver.js';
import { resolveSession } from '../../../../desktop/session/sessionResolution.js';
import { pollReadback } from '../../../../desktop/wrappers/pollReadback.js';
import {
  ArgsValidationError,
  DesktopCommandExecutionError,
  XmlModificationError,
} from '../../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import { resolveShelfField } from '../../api/resolveShelfField.js';
import { sessionParam } from '../../params.js';
import { DesktopTool } from '../../tool.js';

const displayUnitsSchema = z.enum(['none', 'thousands', 'millions', 'billions']);
const currencySymbolSchema = z.enum(['$', '€', '£', '¥']);
const numberFormatSchema = z
  .object({
    field: z.string().trim().min(1).max(255),
    kind: z.enum(['number', 'currency', 'percentage']),
    decimals: z.number().int().min(0).max(2).optional(),
    displayUnits: displayUnitsSchema.optional(),
    currencySymbol: currencySymbolSchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.kind === 'currency' && value.currencySymbol === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['currencySymbol'],
        message: 'currencySymbol is required for currency formats',
      });
    }
    if (value.kind !== 'currency' && value.currencySymbol !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['currencySymbol'],
        message: 'currencySymbol is only allowed for currency formats',
      });
    }
    if (value.kind === 'percentage' && value.displayUnits !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['displayUnits'],
        message: 'displayUnits is not allowed for percentage formats',
      });
    }
  });

const worksheetFormatSchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    showLabels: z.boolean().optional(),
    numberFormats: z.array(numberFormatSchema).min(1).max(12).optional(),
  })
  .refine((value) => value.showLabels !== undefined || value.numberFormats !== undefined, {
    message: 'Each worksheet needs showLabels, numberFormats, or both.',
  });

const paramsSchema = {
  session: sessionParam(),
  worksheets: z.array(worksheetFormatSchema).min(1).max(12),
};

type NumberFormat = z.infer<typeof numberFormatSchema>;
export type WorksheetFormatRequest = {
  showLabels?: boolean;
  numberFormats?: NumberFormat[];
};

export type FormatWorksheetDocumentResult =
  | { ok: true; xml: string }
  | { ok: false; message: string };

type FormattedWorksheet = { worksheet: string; verified: true };

const title = 'Format';

export const getFormatWorksheetsTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'format-worksheets',
    title,
    description: 'Set labels and number formats.',
    paramsSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session, worksheets }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute<{ formatted: FormattedWorksheet[] }>({
        extra,
        args: { session, worksheets },
        callback: async () => {
          const worksheetNames = worksheets.map(({ name }) => name);
          if (new Set(worksheetNames).size !== worksheetNames.length) {
            return new ArgsValidationError('Worksheet names must not contain duplicates.').toErr();
          }

          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) return sessionResult.error.toErr();
          const executor = await extra.getExecutor(sessionResult.value);
          const listed = await executor.listWorksheets(extra.signal);
          if (listed.isErr()) return new DesktopCommandExecutionError(listed.error).toErr();

          const prepared = [];
          for (const request of worksheets) {
            const item = resolveItemByNameOrId(
              'Worksheet',
              request.name,
              listed.value.worksheets ?? [],
            );
            if (item.isErr()) return item.error.toErr();
            const document = await executor.getWorksheetDocument(item.value.id, extra.signal);
            if (document.isErr()) {
              return new DesktopCommandExecutionError(document.error).toErr();
            }
            const edited = formatWorksheetDocument(document.value.xml, {
              showLabels: request.showLabels,
              numberFormats: request.numberFormats,
            });
            if (!edited.ok) return new ArgsValidationError(edited.message).toErr();
            prepared.push({
              worksheet: item.value,
              xml: edited.xml,
              alreadyFormatted: hasRequestedFormatting(document.value.xml, edited.xml),
            });
          }

          const formatted: FormattedWorksheet[] = [];
          for (const { worksheet, xml, alreadyFormatted } of prepared) {
            if (alreadyFormatted) {
              formatted.push({ worksheet: worksheet.name, verified: true });
              continue;
            }
            const applied = await executor.applyWorksheetDocument(worksheet.id, xml, extra.signal);
            if (applied.isErr()) {
              return new DesktopCommandExecutionError(applied.error).toErr();
            }

            const readback = await pollReadback({
              read: async () => await executor.getWorksheetDocument(worksheet.id, extra.signal),
              settled: (value) => hasRequestedFormatting(value.xml, xml),
              signal: extra.signal,
            });
            if (!readback.ok) {
              return new DesktopCommandExecutionError(readback.error).toErr();
            }
            if (!readback.settled) {
              return new XmlModificationError(
                `Desktop accepted formatting for "${worksheet.name}", but the requested labels or number formats did not survive readback.`,
              ).toErr();
            }
            formatted.push({ worksheet: worksheet.name, verified: true });
          }

          return new Ok({ formatted });
        },
      });
    },
  });
  return tool;
};

export function formatWorksheetDocument(
  worksheetXml: string,
  request: WorksheetFormatRequest,
): FormatWorksheetDocumentResult {
  let xml = worksheetXml;
  if (request.showLabels !== undefined) {
    const pane = firstElementBounds(xml, 'pane');
    if (pane === undefined) {
      return { ok: false, message: 'The worksheet has no pane to format.' };
    }
    const paneXml = xml.slice(pane.start, pane.end);
    const nextPane = upsertStyleFormat(paneXml, 'mark', {
      attr: 'mark-labels-show',
      value: request.showLabels ? 'true' : 'false',
    });
    xml = xml.slice(0, pane.start) + nextPane + xml.slice(pane.end);
  }

  for (const format of request.numberFormats ?? []) {
    const resolved = resolveShelfField(xml, format.field);
    if (!resolved.ok) {
      const available = resolved.onShelf
        .map((field) => parseCanonicalColumnRef(field)?.localFieldName ?? field)
        .filter((field, index, fields) => fields.indexOf(field) === index);
      return {
        ok: false,
        message: `Field "${format.field}" is not used by this worksheet. Available fields: ${available.join(', ') || 'none'}.`,
      };
    }
    const value = renderNumberFormat(format);
    xml = upsertTableStyleFormat(xml, 'label', {
      attr: 'text-format',
      field: resolved.column,
      value,
    });
  }
  return { ok: true, xml };
}

function renderNumberFormat(format: NumberFormat): string {
  const decimalCount = format.decimals ?? 0;
  const decimals = decimalCount > 0 ? `.${'0'.repeat(decimalCount)}` : '';
  if (format.kind === 'percentage') return `p0${decimals}%`;
  const unit = {
    none: '',
    thousands: ',K',
    millions: ',,M',
    billions: ',,,B',
  }[format.displayUnits ?? 'none'];
  const body = `#,##0${decimals}${unit}`;
  if (format.kind === 'number') return `n${body};-${body}`;
  const symbol = escapeAttribute(format.currencySymbol ?? '');
  return `c&quot;${symbol}&quot;${body};-&quot;${symbol}&quot;${body}`;
}

type StyleFormat = { attr: string; value: string; field?: string };

function upsertTableStyleFormat(xml: string, element: string, format: StyleFormat): string {
  const panes = xml.search(/<panes\b/);
  const limit = panes === -1 ? xml.length : panes;
  const beforePanes = xml.slice(0, limit);
  const styleMatches = [...beforePanes.matchAll(/<style(?:\s[^>]*)?(?:\/>|>[\s\S]*?<\/style>)/g)];
  const tableStyle = styleMatches.at(-1);
  if (tableStyle?.index !== undefined) {
    const styleXml = tableStyle[0];
    const nextStyle = upsertStyleFormat(styleXml, element, format);
    return (
      xml.slice(0, tableStyle.index) + nextStyle + xml.slice(tableStyle.index + styleXml.length)
    );
  }
  const viewClose = xml.indexOf('</view>');
  if (viewClose === -1) return xml;
  const insertAt = viewClose + '</view>'.length;
  return (
    xml.slice(0, insertAt) +
    `<style>${renderStyleRule(element, format)}</style>` +
    xml.slice(insertAt)
  );
}

function upsertStyleFormat(styleOwnerXml: string, element: string, format: StyleFormat): string {
  const rulePattern = new RegExp(
    `<style-rule\\b[^>]*element=(['"])${escapeRegExp(element)}\\1[^>]*>[\\s\\S]*?<\\/style-rule>`,
  );
  const rule = rulePattern.exec(styleOwnerXml);
  if (rule?.index !== undefined) {
    const nextRule = upsertFormatInRule(rule[0], format);
    return (
      styleOwnerXml.slice(0, rule.index) +
      nextRule +
      styleOwnerXml.slice(rule.index + rule[0].length)
    );
  }

  const rendered = renderStyleRule(element, format);
  const selfClosing = /<style\s*\/>/.exec(styleOwnerXml);
  if (selfClosing?.index !== undefined) {
    return (
      styleOwnerXml.slice(0, selfClosing.index) +
      `<style>${rendered}</style>` +
      styleOwnerXml.slice(selfClosing.index + selfClosing[0].length)
    );
  }
  const styleClose = styleOwnerXml.indexOf('</style>');
  if (styleClose !== -1) {
    return styleOwnerXml.slice(0, styleClose) + rendered + styleOwnerXml.slice(styleClose);
  }
  const ownerOpenEnd = styleOwnerXml.indexOf('>') + 1;
  return (
    styleOwnerXml.slice(0, ownerOpenEnd) +
    `<style>${rendered}</style>` +
    styleOwnerXml.slice(ownerOpenEnd)
  );
}

function upsertFormatInRule(ruleXml: string, format: StyleFormat): string {
  const attr = escapeRegExp(format.attr);
  const fieldLookahead = format.field
    ? `(?=[^>]*field=(['"])${escapeRegExp(escapeAttribute(format.field))}\\2)`
    : '';
  const pattern = new RegExp(`<format\\b(?=[^>]*attr=(['"])${attr}\\1)${fieldLookahead}[^>]*\\/>`);
  const rendered = renderFormat(format);
  if (pattern.test(ruleXml)) return ruleXml.replace(pattern, () => rendered);
  return ruleXml.replace('</style-rule>', () => `${rendered}</style-rule>`);
}

function renderStyleRule(element: string, format: StyleFormat): string {
  return `<style-rule element='${escapeAttribute(element)}'>${renderFormat(format)}</style-rule>`;
}

function renderFormat(format: StyleFormat): string {
  const field = format.field ? ` field='${escapeAttribute(format.field)}'` : '';
  return `<format attr='${escapeAttribute(format.attr)}'${field} value='${format.value}'/>`;
}

function hasRequestedFormatting(readbackXml: string, intendedXml: string): boolean {
  const requested = formattingKeys(intendedXml);
  const actual = new Set(formattingKeys(readbackXml));
  return requested.every((format) => actual.has(format));
}

function formattingKeys(xml: string): string[] {
  return [...xml.matchAll(/<format\b[^>]*\/?\s*>/g)].flatMap(([tag]) => {
    const attributes = new Map(
      [...tag.matchAll(/([\w:-]+)=(['"])(.*?)\2/g)].map((match) => [match[1], match[3]]),
    );
    const attr = attributes.get('attr');
    if (attr !== 'mark-labels-show' && attr !== 'text-format') return [];
    return [`${attr}\0${attributes.get('field') ?? ''}\0${attributes.get('value') ?? ''}`];
  });
}

function firstElementBounds(xml: string, tag: string): { start: number; end: number } | undefined {
  const open = new RegExp(`<${tag}\\b[^>]*>`).exec(xml);
  if (open?.index === undefined) return undefined;
  const close = xml.indexOf(`</${tag}>`, open.index);
  if (close === -1) return undefined;
  return { start: open.index, end: close + tag.length + 3 };
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/'/g, '&apos;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
