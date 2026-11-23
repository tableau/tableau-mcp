import { CallToolResult } from '@modelcontextprotocol/server';
import { Result } from 'ts-results-es';
import { z } from 'zod';

import {
  endpointNotInThisBuild,
  isRouteMissing,
  resolveItemByNameOrId,
} from '../../../desktop/externalApi/toolUtils.js';
import { SheetKind } from '../../../desktop/externalApi/types.js';
import { redactDatasourceCredentials } from '../../../desktop/limits/datasourceCredentialRedaction.js';
import { parseXML } from '../../../desktop/metadata/parser.js';
import { worksheetFragmentSimpleId } from '../../../desktop/metadata/sheets.js';
import { resolveSession } from '../../../desktop/session/sessionResolution.js';
import { getDashboardXml } from '../../../desktop/wrappers/getDashboardXml.js';
import { getWorkbookXml } from '../../../desktop/wrappers/getWorkbookXml.js';
import { getWorksheetXml } from '../../../desktop/wrappers/getWorksheetXml.js';
import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import {
  DesktopCommandExecutionError,
  GetDashboardXmlFailedError,
  GetWorksheetXmlFailedError,
} from '../../../errors/mcpToolError.desktop.js';
import { ArgsValidationError, McpToolError, UnknownError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { clearStickyWorksheetFile } from '../authoring/fields/worksheetEditBuffer.js';
import { sessionParam, xmlModeParam } from '../params.js';
import { DesktopTool } from '../tool.js';
import { TableauDesktopRequestHandlerExtra } from '../toolContext.js';
import { resolveDatasource } from './resolveDatasourceRef.js';
import { finishXmlRead, XmlReadFileResult } from './xmlReadResult.js';

const paramsSchema = {
  session: sessionParam(),
  kind: z
    .enum(['worksheet', 'dashboard', 'storyboard', 'datasource'])
    .optional()
    .describe('Omit for the whole workbook.'),
  sheetId: z.string().min(1).optional().describe('Sheet id or name, for sheet kinds.'),
  datasourceId: z
    .string()
    .min(1)
    .optional()
    .describe('Datasource id or name, for kind datasource.'),
  mode: xmlModeParam(),
};

type GetXmlToolResult =
  | {
      message: string;
      workbookXml?: string;
      worksheetXml?: string;
      dashboardXml?: string;
      storyboardXml?: string;
      datasourceXml?: string;
    }
  | XmlReadFileResult;

const XML_READ_ANNOTATIONS = {
  readOnlyHint: false, // Writes to a cache file
  openWorldHint: false,
  destructiveHint: false,
  idempotentHint: false, // A new cache file is created for each tool call
};

export const getXmlTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const getXml = new DesktopTool({
    server,
    name: 'get-xml',
    title: 'Get Structure',
    description:
      'Get the live structure of the workbook or one EXISTING sheet or datasource. ' +
      'A worksheet read resets its edit buffer; for drafts, read the cached file.',
    paramsSchema,
    annotations: XML_READ_ANNOTATIONS,
    callback: async (
      { session, kind, sheetId, datasourceId, mode },
      extra,
    ): Promise<CallToolResult> => {
      return await getXml.logAndExecute<GetXmlToolResult>({
        extra,
        args: { session, kind, sheetId, datasourceId, mode },
        callback: async () => await readXml({ session, kind, sheetId, datasourceId, mode, extra }),
      });
    },
  });

  return getXml;
};

async function readXml({
  session,
  kind,
  sheetId,
  datasourceId,
  mode,
  extra,
}: {
  session: string | undefined;
  kind?: SheetKind | 'datasource';
  sheetId?: string;
  datasourceId?: string;
  mode: 'file' | 'inline';
  extra: TableauDesktopRequestHandlerExtra;
}): Promise<Result<GetXmlToolResult, McpToolError>> {
  if (kind === 'datasource') {
    if (sheetId !== undefined) {
      return new ArgsValidationError('sheetId does not apply to kind datasource.').toErr();
    }
    if (datasourceId === undefined) {
      return new ArgsValidationError('datasourceId is required with kind datasource.').toErr();
    }
    return await readDatasourceXml({ session, datasourceId, mode, extra });
  }
  if (datasourceId !== undefined) {
    return new ArgsValidationError('datasourceId requires kind datasource.').toErr();
  }
  if (kind === undefined) {
    if (sheetId !== undefined) {
      return new ArgsValidationError('sheetId requires kind.').toErr();
    }
    return await readWorkbookXml({ session, mode, extra });
  }
  if (sheetId === undefined) {
    return new ArgsValidationError(`sheetId is required with kind ${kind}.`).toErr();
  }

  switch (kind) {
    case 'worksheet':
      return await readWorksheetXml({ session, sheetId, mode, extra });
    case 'dashboard':
      return await readDashboardXml({ session, sheetId, mode, extra });
    case 'storyboard':
      return await readStoryboardXml({ session, sheetId, mode, extra });
  }
}

type ReadArgs = {
  session: string | undefined;
  mode: 'file' | 'inline';
  extra: TableauDesktopRequestHandlerExtra;
};

async function readWorkbookXml({
  session,
  mode,
  extra,
}: ReadArgs): Promise<Result<GetXmlToolResult, McpToolError>> {
  const sessionResult = resolveSession(session);
  if (sessionResult.isErr()) {
    return sessionResult.error.toErr();
  }
  const resolvedSession = sessionResult.value;
  const executor = await extra.getExecutor(resolvedSession);
  const result = await getWorkbookXml({ executor, signal: extra.signal });

  if (result.isErr()) {
    return new DesktopCommandExecutionError(result.error).toErr();
  }

  return finishXmlRead({
    kind: 'workbook',
    artifactKind: 'workbook',
    label: 'Workbook',
    inlineKey: 'workbookXml',
    toolName: 'get-xml',
    applyTool: 'apply-workbook',
    pathParam: 'workbookFile',
    xml: redactDatasourceCredentials(result.value),
    mode,
    capBytes: extra.config.inlineXmlMaxBytes,
    resolvedSession,
  });
}

async function readWorksheetXml({
  session,
  sheetId,
  mode,
  extra,
}: ReadArgs & { sheetId: string }): Promise<Result<GetXmlToolResult, McpToolError>> {
  const sessionResult = resolveSession(session);
  if (sessionResult.isErr()) {
    return sessionResult.error.toErr();
  }
  const resolvedSession = sessionResult.value;
  const executor = await extra.getExecutor(resolvedSession);
  const result = await getWorksheetXml({ worksheetName: sheetId, executor, signal: extra.signal });

  if (result.isErr()) {
    const { type, error } = result.error;
    switch (type) {
      case 'get-worksheet-xml-error':
        return new GetWorksheetXmlFailedError(error).toErr();
      case 'execute-command-error':
        if (isRouteMissing(error)) {
          return endpointNotInThisBuild('worksheet document').toErr();
        }
        return new DesktopCommandExecutionError(error).toErr();
      default: {
        const _: never = type;
        return new UnknownError(error).toErr();
      }
    }
  }

  // An explicit re-read is the agent asking for live truth for this sheet — treat it
  // as the new starting point rather than resuming whatever add-field/remove-field
  // edit buffer might already be open underneath it. The buffer keys on the fragment's
  // simple-id; a well-formed fragment always carries one, so a missing id means a
  // malformed document, not a sheet to silently skip.
  const bufferWorksheetId = worksheetFragmentSimpleId(result.value.xml);
  if (!bufferWorksheetId) {
    return new GetWorksheetXmlFailedError({
      type: 'malformed-worksheet-fragment',
      message: `Worksheet "${result.value.name}" has no <simple-id>; the workbook document is malformed.`,
    }).toErr();
  }
  clearStickyWorksheetFile({
    session: resolvedSession,
    worksheetId: bufferWorksheetId,
  });

  return finishXmlRead({
    kind: 'worksheet',
    artifactKind: 'worksheet',
    label: `Worksheet "${result.value.name}"`,
    inlineKey: 'worksheetXml',
    toolName: 'get-xml',
    applyTool: 'apply-worksheet',
    pathParam: 'worksheetFile',
    cacheName: result.value.name,
    xml: result.value.xml,
    mode,
    capBytes: extra.config.inlineXmlMaxBytes,
    resolvedSession,
  });
}

async function readDashboardXml({
  session,
  sheetId,
  mode,
  extra,
}: ReadArgs & { sheetId: string }): Promise<Result<GetXmlToolResult, McpToolError>> {
  const sessionResult = resolveSession(session);
  if (sessionResult.isErr()) {
    return sessionResult.error.toErr();
  }
  const resolvedSession = sessionResult.value;
  const executor = await extra.getExecutor(resolvedSession);
  const result = await getDashboardXml({ dashboardName: sheetId, executor, signal: extra.signal });

  if (result.isErr()) {
    const { type, error } = result.error;
    switch (type) {
      case 'get-dashboard-xml-error':
        return new GetDashboardXmlFailedError(error).toErr();
      case 'execute-command-error':
        if (isRouteMissing(error)) {
          return endpointNotInThisBuild('dashboard document').toErr();
        }
        return new DesktopCommandExecutionError(error).toErr();
      default: {
        const _: never = type;
        return new UnknownError(String(error)).toErr();
      }
    }
  }

  return finishXmlRead({
    kind: 'dashboard',
    artifactKind: 'dashboard',
    label: `Dashboard "${result.value.name}"`,
    inlineKey: 'dashboardXml',
    toolName: 'get-xml',
    applyTool: 'apply-dashboard',
    pathParam: 'dashboardFile',
    cacheName: result.value.name,
    xml: result.value.xml,
    mode,
    capBytes: extra.config.inlineXmlMaxBytes,
    resolvedSession,
  });
}

async function readStoryboardXml({
  session,
  sheetId,
  mode,
  extra,
}: ReadArgs & { sheetId: string }): Promise<Result<GetXmlToolResult, McpToolError>> {
  return await runExternalApiReadTool({
    session,
    extra,
    callback: async (_executor, _signal, read, resolvedSession) => {
      const listResult = await read(
        'storyboard list',
        async (executor, signal) => await executor.listStoryboards(signal),
      );
      if (listResult.isErr()) {
        return listResult;
      }
      const storyboardResult = resolveItemByNameOrId(
        'Storyboard',
        sheetId,
        listResult.value.storyboards ?? [],
      );
      if (storyboardResult.isErr()) {
        return storyboardResult.error.toErr();
      }
      const { id, name } = storyboardResult.value;
      const document = await read(
        'storyboard document',
        async (executor, signal) => await executor.getStoryboardDocument(id, signal),
      );
      if (document.isErr()) {
        return document;
      }

      // A storyboard serializes as a bare `<dashboard type='storyboard'>` fragment.
      const storyboardXml = document.value.xml;
      if (!parseXML(storyboardXml).dashboard) {
        return new UnknownError(`No storyboard document subtree found for "${name}".`).toErr();
      }

      return finishXmlRead({
        kind: 'storyboard',
        // A storyboard has no dedicated ArtifactKind; it shares the dashboard summary shape.
        artifactKind: 'dashboard',
        label: `Storyboard "${name}"`,
        inlineKey: 'storyboardXml',
        toolName: 'get-xml',
        applyTool: 'apply-storyboard',
        pathParam: 'storyboardFile',
        cacheName: name,
        xml: storyboardXml,
        mode,
        capBytes: extra.config.inlineXmlMaxBytes,
        resolvedSession,
      });
    },
  });
}

async function readDatasourceXml({
  session,
  datasourceId,
  mode,
  extra,
}: ReadArgs & { datasourceId: string }): Promise<Result<GetXmlToolResult, McpToolError>> {
  return await runExternalApiReadTool({
    session,
    extra,
    callback: async (executor, _signal, read, resolvedSession) => {
      const list = await read(
        'workbook datasources',
        async (executor, signal) => await executor.listWorkbookDatasources(signal),
      );
      if (list.isErr()) {
        return list;
      }
      const resolved = resolveDatasource(datasourceId, list.value.datasources ?? []);
      if (resolved.isErr()) {
        return resolved.error.toErr();
      }
      const { id, name } = resolved.value;
      const document = await read(
        'datasource document',
        async (executor, signal) => await executor.getDatasourceDocument(id, signal),
      );
      if (document.isErr()) {
        return document;
      }

      return finishXmlRead({
        kind: 'datasource',
        artifactKind: 'datasource',
        label: `Datasource "${name}"`,
        inlineKey: 'datasourceXml',
        toolName: 'get-xml',
        applyTool: 'apply-datasource',
        pathParam: 'datasourceFile',
        cacheName: name,
        xml: redactDatasourceCredentials(document.value.xml),
        mode,
        capBytes: extra.config.inlineXmlMaxBytes,
        resolvedSession,
      });
    },
  });
}
