import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { resolveSession } from '../../../../desktop/session/sessionResolution.js';
import { getWorkbookXml } from '../../../../desktop/wrappers/getWorkbookXml.js';
import {
  ArgsValidationError,
  DesktopCommandExecutionError,
  XmlModificationError,
} from '../../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import { sessionParam } from '../../params.js';
import { DesktopTool } from '../../tool.js';
import { applyAndVerify } from './applyAndVerify.js';
import { DatasourceElement, selectTargetDatasource } from './authorCalcCore.js';

const datatypeSchema = z.enum(['integer', 'real', 'string', 'boolean', 'date']);

// Primitives in, a parameter created in place out. A parameter materializes only through
// dependency resolution: the live model reconstructs the Parameters datasource from a
// `<datasource-dependencies datasource='Parameters'>` block hung off a real datasource
// (live-proven 2026-08-20 against a running instance — the block alone is sufficient, and a
// bare top-level Parameters datasource is dropped). So we inject that block and apply the
// document to the running instance the same way every sibling authoring tool does (via the
// shared applyAndVerify helper). No stage file, no reopen.
const paramsSchema = {
  session: sessionParam(),
  caption: z.string().describe(''),
  datatype: datatypeSchema.default('integer').describe(''),
  value: z.string().describe(''),
  members: z.array(z.string()).optional().describe(''),
  datasource: z.string().optional().describe('Internal datasource name or unique caption.'),
};

type AuthorParameterResult = {
  parameterName: string;
  caption: string;
  applied: 'in-place';
  session: string;
  hint: string;
};

const PARAM_DEP_OPEN = "<datasource-dependencies datasource='Parameters'>";
const PARAM_DEP_CLOSE = '</datasource-dependencies>';

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
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    callback: async (
      { session, caption, datatype = 'integer', value, members, datasource },
      extra,
    ): Promise<CallToolResult> => {
      return await tool.logAndExecute<AuthorParameterResult>({
        extra,
        args: { session, caption, datatype, value, members, datasource },
        callback: async () => {
          if (caption.trim().length === 0) {
            return new ArgsValidationError('caption empty').toErr();
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

          if (hasParameterCaption(liveXml, caption)) {
            return new ArgsValidationError(
              'caption collision — that parameter already exists; pick a new caption',
            ).toErr();
          }

          const hostResult = selectTargetDatasource(liveXml, datasource);
          if (hostResult.isErr()) {
            return hostResult.error.toErr();
          }

          const paramName = nextParameterName(liveXml);
          const columnXml = renderParameterColumn({ caption, paramName, datatype, value, members });
          const editedXml = injectParameterDependency(liveXml, hostResult.value, columnXml);

          const outcome = await applyAndVerify({
            xml: editedXml,
            baselineXml: liveXml,
            settled: (xml) => hasParameterCaption(xml, caption),
            executor,
            signal: extra.signal,
          });
          if (outcome.status === 'failed') {
            return outcome.error.toErr();
          }
          if (outcome.status === 'not-applied') {
            return new XmlModificationError(
              'load completed but the parameter did not materialize: readback did not contain the new parameter caption',
            ).toErr();
          }

          return new Ok({
            parameterName: paramName,
            caption,
            applied: 'in-place' as const,
            session: sessionResult.value,
            hint: 'parameter created in place; the session is unchanged — continue authoring against the same instance',
          });
        },
        getSuccessResult: (result): CallToolResult => ({
          isError: false,
          content: [{ type: 'text', text: JSON.stringify(result) }],
        }),
      });
    },
  });

  return tool;
};

// Insert the full parameter <column> into a `<datasource-dependencies datasource='Parameters'>`
// block on the host datasource
function injectParameterDependency(
  xml: string,
  host: DatasourceElement,
  columnXml: string,
): string {
  if (host.selfClosing) {
    const openTag = xml.slice(host.openStart, host.openEnd).replace(/\/\s*>$/, '>');
    const block = `${PARAM_DEP_OPEN}${columnXml}${PARAM_DEP_CLOSE}`;
    return `${xml.slice(0, host.openStart)}${openTag}${block}</datasource>${xml.slice(host.openEnd)}`;
  }

  const existing = /<datasource-dependencies\b[^>]*\bdatasource=(['"])Parameters\1[^>]*>/.exec(
    host.xml,
  );
  if (existing && existing.index !== undefined) {
    const closeRel = host.xml.indexOf(PARAM_DEP_CLOSE, existing.index + existing[0].length);
    if (closeRel !== -1) {
      const absClose = host.openStart + closeRel;
      return xml.slice(0, absClose) + columnXml + xml.slice(absClose);
    }
  }

  const block = `${PARAM_DEP_OPEN}${columnXml}${PARAM_DEP_CLOSE}`;
  return xml.slice(0, host.closeStart) + block + xml.slice(host.closeStart);
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
