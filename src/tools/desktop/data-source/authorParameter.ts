import { writeFileSync } from 'fs';
import { resolve } from 'path';

import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { getExternalApiDiscoveryDir } from '../../../desktop/externalApi/discovery.js';
import { getWorkbookXml } from '../../../desktop/commands/workbook/getWorkbookXml.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import { deriveStageSiblingPath, reopenFromStage } from '../../../desktop/stageReopen.js';
import {
  ArgsValidationError,
  DesktopCommandExecutionError,
  FileReadError,
  McpToolError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';
import { TableauDesktopRequestHandlerExtra } from '../toolContext.js';

const datatypeSchema = z.enum(['integer', 'real', 'string', 'boolean', 'date']);

// Primitives in, Parameters-datasource XML server-side, a ready-to-open stage out.
// PROVEN live 2026-07-19 (CODA): the Parameters datasource is FROZEN to live merge —
// create/add/value-edit are all silently refused (envelope SUCCEEDED, readback
// unchanged). A parameter is born ONLY at OPEN time: seed it into the document on
// disk, then reopen and re-pin when the live Desktop stack can prove the reopened
// document contains the new parameter. Parameters are the "key signature" —
// established once, at the top.
const paramsSchema = {
  session: z.string().optional().describe(''),
  caption: z.string().describe(''),
  datatype: datatypeSchema.default('integer').describe(''),
  value: z.string().describe(''),
  members: z.array(z.string()).optional().describe(''),
  stagePath: z.string().optional().describe(''),
};

type AuthorParameterFallbackResult = {
  parameterName: string;
  caption: string;
  stagePath: string;
  reopenRequired: true;
  hint: string;
  reopenError?: string;
};

type AuthorParameterReopenedResult = {
  parameterName: string;
  caption: string;
  stagePath: string;
  reopened: true;
  oldSession: string;
  newSession: string;
  hint: string;
  killWarning?: string;
};

type AuthorParameterResult = AuthorParameterFallbackResult | AuthorParameterReopenedResult;

const title = 'Author Parameter';
export const getAuthorParameterTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'author-parameter',
    title,
    description: 'Author parameter.',
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    callback: async (
      { session, caption, datatype = 'integer', value, members, stagePath },
      extra,
    ): Promise<CallToolResult> => {
      return await tool.logAndExecute<AuthorParameterResult>({
        extra,
        args: { session, caption, datatype, value, members, stagePath },
        callback: async () => {
          if (caption.trim().length === 0) {
            return new ArgsValidationError('caption empty').toErr();
          }

          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }

          // Untaught agents should not have to invent filesystem paths: when stagePath
          // is omitted, stage beside the live workbook's own file.
          let effectiveStagePath = stagePath?.trim() ?? '';
          if (effectiveStagePath.length === 0) {
            const derivedResult = await deriveStageSiblingPath({ oldPid: sessionResult.value });
            if (derivedResult.isErr()) {
              return derivedResult.error.toErr();
            }
            effectiveStagePath = derivedResult.value;
          }

          const executor = await extra.getExecutor(sessionResult.value);
          const readResult = await getWorkbookXml({ executor, signal: extra.signal });
          if (readResult.isErr()) {
            return new DesktopCommandExecutionError(readResult.error).toErr();
          }
          const liveXml = readResult.value;

          if (hasParameterCaption(liveXml, caption)) {
            return new ArgsValidationError(
              'caption collision — that parameter already exists; pick a new caption',
            ).toErr();
          }

          const paramName = nextParameterName(liveXml);
          const columnXml = renderParameterColumn({ caption, paramName, datatype, value, members });
          const editResult = seedParameterColumn(liveXml, columnXml);
          if (editResult.isErr()) {
            return editResult.error.toErr();
          }

          const trimmedStagePath = effectiveStagePath;
          try {
            writeFileSync(resolve(trimmedStagePath), editResult.value, 'utf-8');
          } catch (error) {
            return new FileReadError(error).toErr();
          }

          const fallback = (reopenError?: string): Ok<AuthorParameterFallbackResult> =>
            new Ok({
              parameterName: paramName,
              caption,
              stagePath: trimmedStagePath,
              reopenRequired: true,
              hint: 'parameters are born at OPEN — reopen Desktop from stagePath and re-pin the session; merged calcs/sets/actions/formatting carry through the reopen',
              ...(reopenError ? { reopenError } : {}),
            });

          // Same resolution as instance discovery: env override, else the platform's
          // standard dir — the serving path never forwards the env, so a hard guard
          // here would silently kill the reopen in production.
          const discoveryDir = getExternalApiDiscoveryDir();

          const reopenResult = await reopenFromStage({
            stagePath: trimmedStagePath,
            oldPid: sessionResult.value,
            discoveryDir,
          });
          if (reopenResult.isErr()) {
            return fallback(oneLineReason(reopenResult.error));
          }

          const verifyResult = await verifyReopenedParameter({
            getExecutor: extra.getExecutor,
            newPid: reopenResult.value.newPid,
            signal: extra.signal,
            caption,
          });
          if (verifyResult.isErr()) {
            return fallback(oneLineReason(verifyResult.error));
          }

          if (process.env.TABLEAU_DESKTOP_SESSION_ID !== undefined) {
            process.env.TABLEAU_DESKTOP_SESSION_ID = String(reopenResult.value.newPid);
          }

          const killWarning = terminateOldSession(sessionResult.value);

          return new Ok({
            parameterName: paramName,
            caption,
            stagePath: trimmedStagePath,
            reopened: true,
            oldSession: sessionResult.value,
            newSession: reopenResult.value.newPid,
            hint: 'parameter born at reopen; session re-pinned — continue authoring, melody merges (calcs/sets/actions/formatting) now target the reopened instance',
            ...(killWarning ? { killWarning } : {}),
          });
        },
      });
    },
  });

  return tool;
};

async function verifyReopenedParameter({
  getExecutor,
  newPid,
  signal,
  caption,
}: {
  getExecutor: TableauDesktopRequestHandlerExtra['getExecutor'];
  newPid: string;
  signal: AbortSignal;
  caption: string;
}): Promise<Result<void, McpToolError>> {
  try {
    const executor = await getExecutor(newPid);
    const readResult = await getWorkbookXml({ executor, signal });
    if (readResult.isErr()) {
      return new DesktopCommandExecutionError(readResult.error).toErr();
    }
    if (!hasParameterCaption(readResult.value, caption)) {
      return new ArgsValidationError(
        `reopened workbook did not contain parameter caption ${caption}`,
      ).toErr();
    }
    return Ok.EMPTY;
  } catch (error) {
    return new ArgsValidationError(`failed to verify reopened workbook: ${oneLineReason(error)}`).toErr();
  }
}

function terminateOldSession(oldPid: string): string | undefined {
  try {
    process.kill(Number(oldPid), 'SIGTERM');
    return undefined;
  } catch (error) {
    return `failed to terminate old Tableau Desktop pid ${oldPid}: ${oneLineReason(error)}`;
  }
}

function oneLineReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, ' ').trim();
}

function hasParameterCaption(xml: string, caption: string): boolean {
  const ds = parametersDatasource(xml);
  if (ds === undefined) {
    return false;
  }
  return [...ds.matchAll(/<column\b[^>]*\bparam-domain-type=[^>]*>/g)].some(
    (match) => unescapeXml(getAttr(match[0], 'caption') ?? '') === caption,
  );
}

function nextParameterName(xml: string): string {
  const used = new Set(
    [...xml.matchAll(/\bname=(['"])\[Parameter (\d+)\]\1/g)].map((match) => Number(match[2])),
  );
  let n = 1;
  while (used.has(n)) {
    n += 1;
  }
  return `[Parameter ${n}]`;
}

function renderParameterColumn({
  caption,
  paramName,
  datatype,
  value,
  members,
}: {
  caption: string;
  paramName: string;
  datatype: z.infer<typeof datatypeSchema>;
  value: string;
  members?: Array<string>;
}): string {
  const isString = datatype === 'string' || datatype === 'date';
  const domain = members && members.length > 0 ? 'list' : 'any';
  const role = 'measure';
  const type = isString ? 'nominal' : 'quantitative';
  // String/date parameter values are quoted in the value attr and the formula.
  const wrap = (raw: string): string => (isString ? `"${raw}"` : raw);
  const valueAttr = escapeXml(wrap(value));
  const formula = escapeXml(wrap(value));
  const customized = datatype === 'integer' ? " datatype-customized='true'" : '';

  let membersXml = '';
  if (members && members.length > 0) {
    membersXml =
      '<members>' +
      members.map((m) => `<member value='${escapeXml(wrap(m))}' />`).join('') +
      '</members>';
  }

  return (
    `<column caption='${escapeXml(caption)}' datatype='${datatype}'${customized} ` +
    `name='${escapeXml(paramName)}' param-domain-type='${domain}' role='${role}' type='${type}' value='${valueAttr}'>` +
    `<calculation class='tableau' formula='${formula}' />${membersXml}</column>`
  );
}

// Splice the parameter column into the Parameters datasource, creating that datasource
// (right after <datasources>) if the document has none. An EMPTY Parameters ds is
// dropped by Desktop on load — one carrying a real column survives (live-proven).
function seedParameterColumn(
  xml: string,
  columnXml: string,
): Result<string, ArgsValidationError> {
  const dsOpen = /<datasource\b[^>]*\bname=(['"])Parameters\1[^>]*>/.exec(xml);
  if (dsOpen && dsOpen.index !== undefined) {
    const close = xml.indexOf('</datasource>', dsOpen.index);
    if (close === -1) {
      return new ArgsValidationError('malformed document: Parameters datasource is not closed').toErr();
    }
    return new Ok(xml.slice(0, close) + columnXml + xml.slice(close));
  }

  const blockOpen = xml.indexOf('<datasources>');
  if (blockOpen === -1) {
    return new ArgsValidationError('document has no <datasources> block to seed into').toErr();
  }
  const insertAt = blockOpen + '<datasources>'.length;
  const newDs =
    `<datasource hasconnection='false' inline='true' name='Parameters' version='18.1'>` +
    `<aliases enabled='yes' />${columnXml}</datasource>`;
  return new Ok(xml.slice(0, insertAt) + newDs + xml.slice(insertAt));
}

function parametersDatasource(xml: string): string | undefined {
  const open = /<datasource\b[^>]*\bname=(['"])Parameters\1[^>]*>/.exec(xml);
  if (!open || open.index === undefined) {
    return undefined;
  }
  const close = xml.indexOf('</datasource>', open.index);
  return close === -1 ? undefined : xml.slice(open.index, close + '</datasource>'.length);
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
