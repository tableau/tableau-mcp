import { Err, Ok, Result } from 'ts-results-es';

import { log } from '../../logging/logger.js';
import {
  ApplyWorkbookDocumentOptions,
  ExecuteCommandError,
  ExecuteCommandResult,
  ExecuteCommandWarning,
  WithExecutorAndAbortSignal,
} from '../externalApi/executorTypes.js';
import { ExternalApiToolExecutor } from '../externalApi/externalApiToolExecutor.js';
import { isRouteMissing, resolveItemByNameOrId } from '../externalApi/toolUtils.js';
import type { WorkbookDiagnostics } from '../externalApi/types.js';
import { worksheetDocumentState } from '../metadata/worksheetRenderState.js';
import { introducedBlockingValidationIssues, runValidation } from '../validation/registry.js';
import { type ValidationContext, type ValidationIssue } from '../validation/types.js';
import { parsedXmlNamesEqual, parseOuterElement } from '../xmlElement.js';
import { type ApplyFocus, dispatchApplyFocus } from './applyFocus.js';
import { sourceSha256 } from './cacheFingerprint.js';

export type PerSheetKind = 'worksheet' | 'dashboard' | 'storyboard';

/**
 * Outcome of trying to apply a single sheet through its dedicated per-sheet `/document` POST route.
 *
 * The route resolves the target by id and CANNOT create a sheet (an unknown id is a 404 / FAILED
 * operation). Two non-`applied` outcomes report why the surgical POST did not land: the name did not
 * resolve to a live sheet (`sheet-absent` — a net-new sheet, or a pre-existing ambiguity the
 * whole-workbook upsert resolves by first-match).
 */
export type PerSheetApplyOutcome =
  | {
      status: 'applied';
      id: string;
      name: string;
      fragmentXml: string;
      // Empty on a clean apply; every entry is a node Tableau dropped, never a benign notice.
      documentWarnings: ExecuteCommandWarning[];
      diagnostics?: WorkbookDiagnostics;
      diagnosticsInvalid?: boolean;
    }
  | { type: 'dashboard-member-blank-transition'; dashboards: string[] }
  | 'sheet-absent'
  | 'route-missing'
  | 'source-drift'
  | { type: 'validation-failed'; issues: ValidationIssue[] }
  | { type: 'name-differs'; submittedName: string; liveName: string };

const ITEM_LABEL: Record<PerSheetKind, string> = {
  worksheet: 'Worksheet',
  dashboard: 'Dashboard',
  storyboard: 'Storyboard',
};

export type PreparedSheetApply = {
  status: 'prepared';
  expectedInstanceId?: string;
  liveDocumentXml?: string;
  id: string;
  name: string;
  fragmentXml: string;
};

type UnappliedSheetOutcome = Exclude<PerSheetApplyOutcome, { status: 'applied' }>;

/** Resolve identity, source fingerprint and validation before choosing a write route. */
export async function preparePerSheetApply({
  kind,
  sheetName,
  fragmentXml,
  expectedSourceHash,
  expectedInstanceId,
  validationContext,
  executor,
  signal,
}: {
  kind: PerSheetKind;
  sheetName: string;
  fragmentXml: string;
  expectedSourceHash?: string;
  validationContext?: ValidationContext;
  focus: ApplyFocus;
  expectedInstanceId?: string;
} & WithExecutorAndAbortSignal): Promise<
  Result<PreparedSheetApply | UnappliedSheetOutcome, ExecuteCommandError>
> {
  const client = executor as ExternalApiToolExecutor;

  const listResult = await listSheetsOfKind(kind, client, signal);
  if (listResult.isErr()) {
    // A missing list route means the per-sheet POST route is missing too (they ship together).
    if (isRouteMissing(listResult.error)) {
      return Ok('route-missing');
    }
    return Err(listResult.error);
  }
  // Preserve the caller's snapshot pin, or pin the instance that resolved the target.
  // Later document reads and POST rescans must not silently select a replacement instance.
  const preparedInstanceId = expectedInstanceId ?? client.desktopInstanceId;

  const resolved = resolveItemByNameOrId(ITEM_LABEL[kind], sheetName, listResult.value);
  if (resolved.isErr()) {
    // Not found (net-new sheet) or an ambiguous name (which the whole-workbook upsert resolves by
    // first-match): report `sheet-absent` and let the caller decide — surface it (in-place apply) or
    // fall back to the whole-workbook apply (create-capable caller).
    return Ok('sheet-absent');
  }

  let liveDocumentXml: string | undefined;
  if (expectedSourceHash !== undefined || validationContext !== undefined) {
    const documentResult = await getDocumentForKind(kind, resolved.value.id, client, signal);
    if (documentResult.isErr()) return Err(documentResult.error);
    liveDocumentXml = documentResult.value.xml;
    if (expectedSourceHash !== undefined && sourceSha256(liveDocumentXml) !== expectedSourceHash) {
      return Ok('source-drift');
    }
    if (validationContext !== undefined) {
      const introduced = introducedBlockingValidationIssues(
        runValidation(liveDocumentXml, validationContext).issues,
        runValidation(fragmentXml, validationContext).issues,
        validationContext,
      );
      if (introduced.length > 0) return Ok({ type: 'validation-failed', issues: introduced });
    }
  }

  if (kind === 'worksheet' && worksheetDocumentState(fragmentXml) === 'populated') {
    if (liveDocumentXml === undefined) {
      const documentResult = await client.getWorksheetDocument(resolved.value.id, signal);
      if (documentResult.isErr()) return Err(documentResult.error);
      liveDocumentXml = documentResult.value.xml;
    }
    if (worksheetDocumentState(liveDocumentXml) === 'blank') {
      const dashboardsResult = await client.listDashboards(signal);
      if (dashboardsResult.isErr()) return Err(dashboardsResult.error);
      const dashboards = (dashboardsResult.value.dashboards ?? [])
        .filter((dashboard) => dashboard.containedSheets?.includes(resolved.value.id))
        .map((dashboard) => dashboard.name);
      if (dashboards.length > 0) {
        return Ok({ type: 'dashboard-member-blank-transition', dashboards });
      }
    }
  }

  // Desktop requires the root name to equal the live name, and these tools don't rename.
  const submittedName = fragmentRootName(kind, fragmentXml);
  if (submittedName.isErr()) return submittedName;
  if (!parsedXmlNamesEqual(submittedName.value, resolved.value.name)) {
    return Ok({
      type: 'name-differs',
      submittedName: submittedName.value,
      liveName: resolved.value.name,
    });
  }

  return Ok({
    status: 'prepared',
    expectedInstanceId: preparedInstanceId,
    liveDocumentXml,
    id: resolved.value.id,
    name: resolved.value.name,
    fragmentXml,
  });
}

/** Check and apply one edited fragment through its dedicated per-sheet document route. */
export async function tryApplyViaPerSheetRoute(
  args: Parameters<typeof preparePerSheetApply>[0],
): Promise<Result<PerSheetApplyOutcome, ExecuteCommandError>> {
  const prepared = await preparePerSheetApply(args);
  if (prepared.isErr()) return prepared;
  if (typeof prepared.value !== 'object' || !('status' in prepared.value))
    return Ok(prepared.value);
  return applyPreparedSheet({ ...args, prepared: prepared.value });
}

/** Dispatch a checked fragment while the caller still holds the apply lock. */
export async function applyPreparedSheet({
  kind,
  prepared,
  focus,
  executor,
  signal,
  expectedInstanceId,
}: {
  kind: PerSheetKind;
  prepared: PreparedSheetApply;
  focus: ApplyFocus;
  expectedInstanceId?: string;
} & WithExecutorAndAbortSignal): Promise<Result<PerSheetApplyOutcome, ExecuteCommandError>> {
  const client = executor as ExternalApiToolExecutor;
  const applyResult = await applyDocumentForKind(
    kind,
    prepared.id,
    prepared.fragmentXml,
    client,
    signal,
    expectedInstanceId ?? prepared.expectedInstanceId,
  );
  if (applyResult.isErr()) {
    // A build with the list route but not the POST route (unlikely) still falls back cleanly.
    if (isRouteMissing(applyResult.error)) {
      return Ok('route-missing');
    }
    return Err(applyResult.error);
  }

  log({
    level: 'info',
    message: `per-sheet ${kind} document apply completed`,
    logger: 'workbookCommands',
    data: { sheetName: prepared.name, id: prepared.id },
  });

  // The POST moves the view whether we ask or not, so state where it belongs. Never fails the
  // apply that already landed.
  const resolvedFocus: ApplyFocus =
    focus.navigate === 'artifact' ? { ...focus, sheetName: prepared.name } : focus;
  await dispatchApplyFocus({
    focus: resolvedFocus,
    postedXml: prepared.fragmentXml,
    executor,
    signal,
  });

  return Ok({
    status: 'applied',
    id: prepared.id,
    name: prepared.name,
    fragmentXml: prepared.fragmentXml,
    documentWarnings: applyResult.value.warnings ?? [],
    ...(applyResult.value.diagnostics ? { diagnostics: applyResult.value.diagnostics } : {}),
    ...(applyResult.value.diagnosticsInvalid ? { diagnosticsInvalid: true } : {}),
  });
}

function fragmentRootName(
  kind: PerSheetKind,
  fragmentXml: string,
): Result<string, ExecuteCommandError> {
  try {
    const outer = parseOuterElement(fragmentXml);
    if (!outer?.name || outer.tagName !== (kind === 'worksheet' ? 'worksheet' : 'dashboard')) {
      return Err({
        type: 'invalid-response',
        error: new Error(`The ${kind} fragment has no root name.`),
      });
    }
    return Ok(outer.name);
  } catch (error) {
    return Err({ type: 'invalid-response', error });
  }
}

async function getDocumentForKind(
  kind: PerSheetKind,
  id: string,
  client: ExternalApiToolExecutor,
  signal: AbortSignal,
): ReturnType<ExternalApiToolExecutor['getWorksheetDocument']> {
  switch (kind) {
    case 'worksheet':
      return client.getWorksheetDocument(id, signal);
    case 'dashboard':
      return client.getDashboardDocument(id, signal);
    case 'storyboard':
      return client.getStoryboardDocument(id, signal);
  }
}

async function listSheetsOfKind(
  kind: PerSheetKind,
  client: ExternalApiToolExecutor,
  signal: AbortSignal,
): Promise<Result<Array<{ id: string; name: string }>, ExecuteCommandError>> {
  switch (kind) {
    case 'worksheet': {
      const result = await client.listWorksheets(signal);
      return result.map((value) => value.worksheets ?? []);
    }
    case 'dashboard': {
      const result = await client.listDashboards(signal);
      return result.map((value) => value.dashboards ?? []);
    }
    case 'storyboard': {
      const result = await client.listStoryboards(signal);
      return result.map((value) => value.storyboards ?? []);
    }
  }
}

async function applyDocumentForKind(
  kind: PerSheetKind,
  id: string,
  documentXml: string,
  client: ExternalApiToolExecutor,
  signal: AbortSignal,
  expectedInstanceId?: string,
): Promise<Result<ExecuteCommandResult<undefined>, ExecuteCommandError>> {
  switch (kind) {
    case 'worksheet':
      return expectedInstanceId
        ? client.applyWorksheetDocument(id, documentXml, signal, {
            expectedInstanceId,
          } satisfies ApplyWorkbookDocumentOptions)
        : client.applyWorksheetDocument(id, documentXml, signal);
    case 'dashboard':
      return expectedInstanceId
        ? client.applyDashboardDocument(id, documentXml, signal, { expectedInstanceId })
        : client.applyDashboardDocument(id, documentXml, signal);
    case 'storyboard':
      return expectedInstanceId
        ? client.applyStoryboardDocument(id, documentXml, signal, { expectedInstanceId })
        : client.applyStoryboardDocument(id, documentXml, signal);
  }
}
