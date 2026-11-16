import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import {
  endpointNotInThisBuild,
  isRouteMissing,
  resolveItemByNameOrId,
} from '../../../desktop/externalApi/toolUtils.js';
import { SheetKind } from '../../../desktop/externalApi/types.js';
import { redactDatasourceCredentials } from '../../../desktop/limits/datasourceCredentialRedaction.js';
import { normalizeArray, parseXML } from '../../../desktop/metadata/parser.js';
import { worksheetFragmentSimpleId } from '../../../desktop/metadata/sheets.js';
import { resolveSession } from '../../../desktop/session/sessionResolution.js';
import { getDashboardXml } from '../../../desktop/wrappers/getDashboardXml.js';
import { getWorkbookXml } from '../../../desktop/wrappers/getWorkbookXml.js';
import { getWorksheetXml } from '../../../desktop/wrappers/getWorksheetXml.js';
import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import {
  GetDashboardXmlResult,
  GetWorksheetXmlResult,
  WorkbookReadGateway,
} from '../../../desktop/wrappers/workbookReadGateway.js';
import {
  DesktopCommandExecutionError,
  GetDashboardXmlFailedError,
  GetWorksheetXmlFailedError,
} from '../../../errors/mcpToolError.desktop.js';
import { ArgsValidationError, McpToolError, UnknownError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { clearStickyWorksheetFile } from '../authoring/fields/worksheetEditBuffer.js';
import { artifactNameParam, sessionParam, xmlModeParam } from '../params.js';
import { DesktopTool } from '../tool.js';
import { TableauDesktopRequestHandlerExtra } from '../toolContext.js';
import { isSheetNotFound } from './resolveSheetRef.js';
import { finishXmlRead, XmlReadFileResult } from './xmlReadResult.js';

const paramsSchema = {
  session: sessionParam(),
  kind: z
    .enum(['worksheet', 'dashboard', 'storyboard'])
    .optional()
    .describe('Kind of sheet to read; omit for the whole workbook.'),
  sheetId: z
    .string()
    .min(1)
    .optional()
    .describe('Id (or unique name) of the sheet; required with kind.'),
  mode: xmlModeParam(),
};

type GetXmlToolResult =
  | {
      message: string;
      workbookXml?: string;
      worksheetXml?: string;
      dashboardXml?: string;
      storyboardXml?: string;
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
      'Get the live structure of the workbook or one EXISTING worksheet, dashboard, or storyboard. ' +
      'Reading a worksheet resets its active edit buffer; for pending drafts, read the cached file instead.',
    paramsSchema,
    annotations: XML_READ_ANNOTATIONS,
    callback: async ({ session, kind, sheetId, mode }, extra): Promise<CallToolResult> => {
      return await getXml.logAndExecute<GetXmlToolResult>({
        extra,
        args: { session, kind, sheetId, mode },
        callback: async () => await readXml({ session, kind, sheetId, mode, extra }),
      });
    },
  });

  return getXml;
};

async function readXml({
  session,
  kind,
  sheetId,
  mode,
  extra,
}: {
  session: string | undefined;
  kind?: SheetKind;
  sheetId?: string;
  mode: 'file' | 'inline';
  extra: TableauDesktopRequestHandlerExtra;
}): Promise<Result<GetXmlToolResult, McpToolError>> {
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
  const result = await fetchWorksheetXml(executor, sheetId, extra.signal);

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

async function fetchWorksheetXml(
  executor: ExternalApiToolExecutor,
  sheetId: string,
  signal: AbortSignal,
): Promise<GetWorksheetXmlResult> {
  const byId = await executor.getWorksheetDocument(sheetId, signal);
  if (byId.isOk()) {
    return Ok({ xml: byId.value.xml, name: fragmentName(byId.value.xml, 'worksheet') ?? sheetId });
  }
  if (isRouteMissing(byId.error)) {
    return await new WorkbookReadGateway({ executor, signal }).getWorksheetXmlViaWorkbookDocument(
      sheetId,
    );
  }
  if (isSheetNotFound(byId.error)) {
    return await getWorksheetXml({ worksheetName: sheetId, executor, signal });
  }
  return Err({ type: 'execute-command-error', error: byId.error });
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
  const result = await fetchDashboardXml(executor, sheetId, extra.signal);

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

async function fetchDashboardXml(
  executor: ExternalApiToolExecutor,
  sheetId: string,
  signal: AbortSignal,
): Promise<GetDashboardXmlResult> {
  const byId = await executor.getDashboardDocument(sheetId, signal);
  if (byId.isOk()) {
    return Ok({ xml: byId.value.xml, name: fragmentName(byId.value.xml, 'dashboard') ?? sheetId });
  }
  if (isRouteMissing(byId.error)) {
    return await new WorkbookReadGateway({ executor, signal }).getDashboardXmlViaWorkbookDocument(
      sheetId,
    );
  }
  if (isSheetNotFound(byId.error)) {
    return await getDashboardXml({ dashboardName: sheetId, executor, signal });
  }
  return Err({ type: 'execute-command-error', error: byId.error });
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
    callback: async (executor, signal, read, resolvedSession) => {
      const byId = await executor.getStoryboardDocument(sheetId, signal);
      let name = sheetId;
      let documentResult = byId;
      if (byId.isErr() && isSheetNotFound(byId.error)) {
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
        const resolved = storyboardResult.value;
        name = resolved.name;
        if (resolved.id !== sheetId) {
          documentResult = await executor.getStoryboardDocument(resolved.id, signal);
        }
      }
      const document = await read(
        'storyboard document',
        async () => await Promise.resolve(documentResult),
      );
      if (document.isErr()) {
        return document;
      }

      // A storyboard serializes as a bare `<dashboard type='storyboard'>` fragment.
      const storyboardXml = document.value.xml;
      if (!parseXML(storyboardXml).dashboard) {
        return new UnknownError(`No storyboard document subtree found for "${sheetId}".`).toErr();
      }
      if (byId.isOk()) {
        name = fragmentName(storyboardXml, 'dashboard') ?? sheetId;
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

function fragmentName(xml: string, element: 'worksheet' | 'dashboard'): string | undefined {
  const fragment = normalizeArray(parseXML(xml)[element] as { '@_name'?: string } | undefined)[0];
  return fragment?.['@_name']?.trim() || undefined;
}

const worksheetAliasParamsSchema = {
  session: sessionParam(),
  worksheetName: artifactNameParam('worksheet'),
  mode: xmlModeParam(),
};

export const getGetWorksheetXmlTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof worksheetAliasParamsSchema> => {
  const getWorksheetXmlTool = new DesktopTool({
    server,
    name: 'get-worksheet-xml',
    title: 'Reading worksheet',
    description: 'Deprecated: use get-xml with kind=worksheet instead.',
    paramsSchema: worksheetAliasParamsSchema,
    annotations: XML_READ_ANNOTATIONS,
    callback: async ({ session, worksheetName, mode }, extra): Promise<CallToolResult> => {
      return await getWorksheetXmlTool.logAndExecute<GetXmlToolResult>({
        extra,
        args: { session, worksheetName, mode },
        callback: async () =>
          await readXml({ session, kind: 'worksheet', sheetId: worksheetName, mode, extra }),
      });
    },
  });
  return getWorksheetXmlTool;
};

const dashboardAliasParamsSchema = {
  session: sessionParam(),
  dashboardName: artifactNameParam('dashboard'),
  mode: xmlModeParam(),
};

export const getGetDashboardXmlTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof dashboardAliasParamsSchema> => {
  const getDashboardXmlTool = new DesktopTool({
    server,
    name: 'get-dashboard-xml',
    title: 'Reading dashboard',
    description: 'Deprecated: use get-xml with kind=dashboard instead.',
    paramsSchema: dashboardAliasParamsSchema,
    annotations: XML_READ_ANNOTATIONS,
    callback: async ({ session, dashboardName, mode }, extra): Promise<CallToolResult> => {
      return await getDashboardXmlTool.logAndExecute<GetXmlToolResult>({
        extra,
        args: { session, dashboardName, mode },
        callback: async () =>
          await readXml({ session, kind: 'dashboard', sheetId: dashboardName, mode, extra }),
      });
    },
  });
  return getDashboardXmlTool;
};

const workbookAliasParamsSchema = {
  session: sessionParam(),
  mode: xmlModeParam(),
};

export const getGetWorkbookXmlTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof workbookAliasParamsSchema> => {
  const getWorkbookXmlTool = new DesktopTool({
    server,
    name: 'get-workbook-xml',
    title: 'Reading workbook',
    description: 'Deprecated: use get-xml without kind instead.',
    paramsSchema: workbookAliasParamsSchema,
    annotations: XML_READ_ANNOTATIONS,
    callback: async ({ session, mode }, extra): Promise<CallToolResult> => {
      return await getWorkbookXmlTool.logAndExecute<GetXmlToolResult>({
        extra,
        args: { session, mode },
        callback: async () => await readXml({ session, mode, extra }),
      });
    },
  });
  return getWorkbookXmlTool;
};
