import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { getWorkbookXml } from '../../../desktop/commands/workbook/getWorkbookXml.js';
import { applyWorkbookText } from '../../../desktop/commands/workbook/loadWorkbookXml.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import { validateWorkbookDocumentApply } from '../../../desktop/workbookDocumentGuard.js';
import {
  ArgsValidationError,
  DesktopCommandExecutionError,
  XmlModificationError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

// Primitives in, mark-label format XML server-side, readback out. Turns mark labels
// ON for a worksheet (labels hug the bars) — the finishing polish over the melody.
// PROVEN live 2026-07-19 (CODA): <style><style-rule element='mark'><format
// attr='mark-labels-show' value='true'/></style-rule></style> spliced into a pane
// MERGES via the document round-trip and survives readback.
const paramsSchema = {
  session: z.string().optional().describe(''),
  worksheet: z.string().describe(''),
  showLabels: z.boolean().default(true).describe(''),
};

type FormatLabelsResult = {
  worksheet: string;
  showLabels: boolean;
  hint: string;
};

const title = 'Format Labels';
export const getFormatLabelsTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'format-labels',
    title,
    description: 'Format labels.',
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    callback: async ({ session, worksheet, showLabels = true }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute<FormatLabelsResult>({
        extra,
        args: { session, worksheet, showLabels },
        callback: async () => {
          if (worksheet.trim().length === 0) {
            return new ArgsValidationError('worksheet empty').toErr();
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
          const editResult = setMarkLabels(liveXml, worksheet.trim(), showLabels);
          if (editResult.isErr()) {
            return editResult.error.toErr();
          }
          const editedXml = editResult.value;

          const validation = validateWorkbookDocumentApply(editedXml, liveXml);
          if (!validation.ok) {
            return new ArgsValidationError(validation.message).toErr();
          }

          const loadResult = await applyWorkbookText({
            xml: editedXml,
            executor,
            signal: extra.signal,
          });
          if (loadResult.isErr()) {
            return new DesktopCommandExecutionError(loadResult.error).toErr();
          }

          const readbackResult = await getWorkbookXml({ executor, signal: extra.signal });
          if (readbackResult.isErr()) {
            return new DesktopCommandExecutionError(readbackResult.error).toErr();
          }
          const worksheetXml = extractWorksheet(readbackResult.value, worksheet.trim());
          const applied =
            worksheetXml !== undefined && hasMarkLabelsSetting(worksheetXml, showLabels);
          if (!applied) {
            return new XmlModificationError(
              'load completed but did not apply: readback did not carry the mark-labels setting',
            ).toErr();
          }

          return new Ok({
            worksheet: worksheet.trim(),
            showLabels,
            hint: 'labels now render on the marks; tune font/placement with additional format attrs if needed',
          });
        },
      });
    },
  });

  return tool;
};

// Locate the target worksheet's first <pane> and ensure a mark-labels-show format
// rule reflects showLabels. Idempotent: rewrites an existing rule, else inserts one.
function setMarkLabels(
  xml: string,
  worksheet: string,
  showLabels: boolean,
): Result<string, XmlModificationError | ArgsValidationError> {
  const wsBounds = worksheetBounds(xml, worksheet);
  if (wsBounds === undefined) {
    return new ArgsValidationError(`Worksheet "${worksheet}" was not found.`).toErr();
  }
  const wsXml = xml.slice(wsBounds.start, wsBounds.end);

  const paneOpen = wsXml.search(/<pane\b[^>]*>/);
  if (paneOpen === -1) {
    return new XmlModificationError(
      `Worksheet "${worksheet}" has no <pane> to format (build the viz first).`,
    ).toErr();
  }
  const paneOpenEnd = wsXml.indexOf('>', paneOpen) + 1;

  const value = showLabels ? 'true' : 'false';
  let newWsXml: string;

  const existing = /<format\b[^>]*attr=(['"])mark-labels-show\1[^>]*\/>/.exec(wsXml);
  if (existing) {
    newWsXml = wsXml.replace(existing[0], `<format attr='mark-labels-show' value='${value}' />`);
  } else {
    const styleBlock =
      "<style><style-rule element='mark'>" +
      `<format attr='mark-labels-show' value='${value}' />` +
      '</style-rule></style>';
    // Insert immediately after the pane open tag (a pane may carry its own <style>).
    newWsXml = wsXml.slice(0, paneOpenEnd) + styleBlock + wsXml.slice(paneOpenEnd);
  }

  return new Ok(xml.slice(0, wsBounds.start) + newWsXml + xml.slice(wsBounds.end));
}

function worksheetBounds(xml: string, name: string): { start: number; end: number } | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const open = new RegExp(`<worksheet\\b[^>]*\\bname=(['"])${escaped}\\1[^>]*>`).exec(xml);
  if (!open || open.index === undefined) {
    return undefined;
  }
  const start = open.index;
  const close = xml.indexOf('</worksheet>', start);
  if (close === -1) {
    return undefined;
  }
  return { start, end: close + '</worksheet>'.length };
}

function extractWorksheet(xml: string, name: string): string | undefined {
  const bounds = worksheetBounds(xml, name);
  return bounds === undefined ? undefined : xml.slice(bounds.start, bounds.end);
}

function hasMarkLabelsSetting(worksheetXml: string, showLabels: boolean): boolean {
  const value = showLabels ? 'true' : 'false';
  return new RegExp(
    `<format\\b[^>]*attr=(['"])mark-labels-show\\1[^>]*value=(['"])${value}\\2`,
  ).test(worksheetXml);
}
