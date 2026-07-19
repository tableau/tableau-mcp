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

const activationSchema = z.enum(['on-select', 'on-hover', 'on-menu']);

// Primitives in, <edit-parameter-action> XML server-side, readback out. A parameter
// -change action wires a mark interaction on a source sheet to a target parameter.
// PROVEN live 2026-07-19 (CODA): a workbook-level <actions> block MERGES via the
// document round-trip — the action survived readback with the target-parameter link
// intact. This is the interactivity layer over the key signature.
const paramsSchema = {
  session: z.string().optional().describe(''),
  caption: z.string().describe(''),
  sourceWorksheet: z.string().describe(''),
  sourceField: z.string().describe(''),
  targetParameter: z.string().describe(''),
  activation: activationSchema.default('on-select').describe(''),
};

type AuthorActionResult = {
  actionName: string;
  caption: string;
  targetParameter: string;
  hint: string;
};

const title = 'Author Action';
export const getAuthorActionTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'author-action',
    title,
    description: 'Author action.',
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    callback: async (
      { session, caption, sourceWorksheet, sourceField, targetParameter, activation = 'on-select' },
      extra,
    ): Promise<CallToolResult> => {
      return await tool.logAndExecute<AuthorActionResult>({
        extra,
        args: { session, caption, sourceWorksheet, sourceField, targetParameter, activation },
        callback: async () => {
          if (caption.trim().length === 0) {
            return new ArgsValidationError('caption empty').toErr();
          }
          if (sourceWorksheet.trim().length === 0) {
            return new ArgsValidationError('sourceWorksheet empty').toErr();
          }
          if (targetParameter.trim().length === 0) {
            return new ArgsValidationError('targetParameter empty').toErr();
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
          if (hasActionCaption(liveXml, caption)) {
            return new ArgsValidationError(
              'caption collision — pick a new caption or edit the existing action',
            ).toErr();
          }

          const actionName = nextActionName(liveXml);
          const actionXml = renderParameterAction({
            caption,
            actionName,
            sourceWorksheet,
            sourceField,
            targetParameter,
            activation,
          });
          const editResult = spliceActionIntoWorkbook(liveXml, actionXml);
          if (editResult.isErr()) {
            return editResult.error.toErr();
          }
          const editedXml = editResult.value;

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
          if (!hasActionCaption(readbackResult.value, caption)) {
            return new XmlModificationError(
              'load completed but did not apply: readback did not contain the new action',
            ).toErr();
          }

          return new Ok({
            actionName,
            caption,
            targetParameter,
            hint: 'the source sheet must expose the source field; the target parameter must already exist (author it at open time)',
          });
        },
      });
    },
  });

  return tool;
};

function hasActionCaption(xml: string, caption: string): boolean {
  return [...xml.matchAll(/<(?:action|edit-parameter-action)\b[^>]*>/g)].some(
    (match) => unescapeXml(getAttr(match[0], 'caption') ?? '') === caption,
  );
}

function nextActionName(xml: string): string {
  const used = new Set(
    [...xml.matchAll(/\bname=(['"])\[Action(\d+)[^\]]*\]\1/g)].map((match) => Number(match[2])),
  );
  let n = 1;
  while (used.has(n)) {
    n += 1;
  }
  return `[Action${n}]`;
}

function renderParameterAction({
  caption,
  actionName,
  sourceWorksheet,
  sourceField,
  targetParameter,
  activation,
}: {
  caption: string;
  actionName: string;
  sourceWorksheet: string;
  sourceField: string;
  targetParameter: string;
  activation: z.infer<typeof activationSchema>;
}): string {
  const params: string[] = [];
  if (sourceField.trim().length > 0) {
    params.push(`<param name='source-field' value='${escapeXml(sourceField.trim())}' />`);
  }
  params.push(`<param name='target-parameter' value='${escapeXml(targetParameter.trim())}' />`);
  return (
    `<edit-parameter-action caption='${escapeXml(caption)}' name='${escapeXml(actionName)}'>` +
    `<activation type='${activation}' />` +
    `<source type='sheet' worksheet='${escapeXml(sourceWorksheet.trim())}' />` +
    `<agg-type type='attr' />` +
    `<clear-option type='do-nothing' value='s:LROOT:' />` +
    `<params>${params.join('')}</params>` +
    `</edit-parameter-action>`
  );
}

// Splice a single action into the workbook-level <actions> block, creating the block
// between </datasources> and <worksheets> if it does not yet exist. PROVEN live:
// this is where Tableau expects workbook-scoped actions and where a merge takes.
function spliceActionIntoWorkbook(
  xml: string,
  actionXml: string,
): Result<string, XmlModificationError> {
  const actionsOpen = xml.indexOf('<actions>');
  if (actionsOpen !== -1) {
    const actionsClose = xml.indexOf('</actions>', actionsOpen);
    if (actionsClose === -1) {
      return new XmlModificationError('malformed document: <actions> without </actions>').toErr();
    }
    return new Ok(`${xml.slice(0, actionsClose)}${actionXml}${xml.slice(actionsClose)}`);
  }

  const dsClose = xml.indexOf('</datasources>');
  if (dsClose === -1) {
    return new XmlModificationError(
      'cannot place actions: no </datasources> anchor in document',
    ).toErr();
  }
  const insertAt = dsClose + '</datasources>'.length;
  return new Ok(
    `${xml.slice(0, insertAt)}<actions>${actionXml}</actions>${xml.slice(insertAt)}`,
  );
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
