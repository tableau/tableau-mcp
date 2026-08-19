import { Err, Ok, Result } from 'ts-results-es';

import { log } from '../../logging/logger.js';
import { escapeXml } from '../binder/escape.js';
import { ExecuteCommandError, WithExecutorAndAbortSignal } from '../externalApi/executorTypes.js';
import { ExternalApiToolExecutor } from '../externalApi/externalApiToolExecutor.js';
import { isRouteMissing, resolveItemByNameOrId } from '../externalApi/toolUtils.js';
import { introducedBlockingValidationIssues, runValidation } from '../validation/registry.js';
import { type ValidationContext, type ValidationIssue } from '../validation/types.js';
import { parseOuterElement, xmlNamesEqual } from '../xmlElement.js';
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
  | { status: 'applied'; id: string; name: string; fragmentXml: string }
  | 'sheet-absent'
  | 'route-missing'
  | 'source-drift'
  | { type: 'validation-failed'; issues: ValidationIssue[] };

const ITEM_LABEL: Record<PerSheetKind, string> = {
  worksheet: 'Worksheet',
  dashboard: 'Dashboard',
  storyboard: 'Storyboard',
};

/**
 * Apply one edited sheet fragment in place via its dedicated per-sheet `/document` POST route.
 *
 * Resolves the sheet name to its live id first; a name that does not resolve, or a build that lacks the
 * route, returns a non-`applied` outcome and the caller decides whether to surface it or fall back
 * to the whole-workbook apply. On a successful POST it dispatches the requested focus (best-effort,
 * never fails the landed apply).
 */
export async function tryApplyViaPerSheetRoute({
  kind,
  sheetName,
  fragmentXml,
  expectedSourceHash,
  validationContext,
  focus,
  executor,
  signal,
}: {
  kind: PerSheetKind;
  sheetName: string;
  fragmentXml: string;
  expectedSourceHash?: string;
  validationContext?: ValidationContext;
  focus: ApplyFocus;
} & WithExecutorAndAbortSignal): Promise<Result<PerSheetApplyOutcome, ExecuteCommandError>> {
  const client = executor as ExternalApiToolExecutor;

  const listResult = await listSheetsOfKind(kind, client, signal);
  if (listResult.isErr()) {
    // A missing list route means the per-sheet POST route is missing too (they ship together) —
    // let the caller take the whole-workbook path instead of surfacing a route error.
    if (isRouteMissing(listResult.error)) {
      return Ok('route-missing');
    }
    return Err(listResult.error);
  }

  const resolved = resolveItemByNameOrId(ITEM_LABEL[kind], sheetName, listResult.value);
  if (resolved.isErr()) {
    // Not found (net-new sheet) or an ambiguous name (which the whole-workbook upsert resolves by
    // first-match): report `sheet-absent` and let the caller decide — surface it (in-place apply) or
    // fall back to the whole-workbook apply (create-capable caller).
    return Ok('sheet-absent');
  }

  if (expectedSourceHash !== undefined || validationContext !== undefined) {
    const documentResult = await getDocumentForKind(kind, resolved.value.id, client, signal);
    if (documentResult.isErr()) return Err(documentResult.error);
    if (
      expectedSourceHash !== undefined &&
      sourceSha256(documentResult.value.xml) !== expectedSourceHash
    ) {
      return Ok('source-drift');
    }
    if (validationContext !== undefined) {
      const introduced = introducedBlockingValidationIssues(
        runValidation(documentResult.value.xml, validationContext).issues,
        runValidation(fragmentXml, validationContext).issues,
      );
      if (introduced.length > 0) return Ok({ type: 'validation-failed', issues: introduced });
    }
  }

  const retitledFragment = retitleFragment(kind, fragmentXml, resolved.value.name);
  if (retitledFragment.isErr()) {
    return retitledFragment;
  }

  // The route is addressed by stable id, but Desktop still requires the fragment's root name to
  // match the sheet's current display name. Reconcile a stale cached name before POST; otherwise a
  // rename between read and apply opens a blocking "Requested worksheet(s) not found" dialog.
  const applyResult = await applyDocumentForKind(
    kind,
    resolved.value.id,
    retitledFragment.value,
    client,
    signal,
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
    data: { sheetName, id: resolved.value.id },
  });

  // The POST moves the view whether we ask or not, so state where it belongs. Never fails the
  // apply that already landed.
  const resolvedFocus: ApplyFocus =
    focus.navigate === 'artifact' ? { ...focus, sheetName: resolved.value.name } : focus;
  await dispatchApplyFocus({
    focus: resolvedFocus,
    postedXml: retitledFragment.value,
    executor,
    signal,
  });

  return Ok({
    status: 'applied',
    id: resolved.value.id,
    name: resolved.value.name,
    fragmentXml: retitledFragment.value,
  });
}

function retitleFragment(
  kind: PerSheetKind,
  fragmentXml: string,
  currentName: string,
): Result<string, ExecuteCommandError> {
  try {
    const expectedTag = kind === 'worksheet' ? 'worksheet' : 'dashboard';
    const outer = parseOuterElement(fragmentXml);
    if (!outer?.name || outer.tagName !== expectedTag) {
      return Err({
        type: 'invalid-response',
        error: new Error(`The ${kind} fragment has no root name.`),
      });
    }
    if (xmlNamesEqual(outer.name, currentName)) {
      return Ok(fragmentXml);
    }

    const rootTag = new RegExp(`<${expectedTag}\\b[^>]*>`).exec(fragmentXml);
    const nameAttribute = rootTag ? /(\sname\s*=\s*)(['"])(.*?)\2/.exec(rootTag[0]) : null;
    if (!rootTag || !nameAttribute) {
      return Err({
        type: 'invalid-response',
        error: new Error(`The ${kind} fragment has no root name.`),
      });
    }

    const valueStart =
      rootTag.index + nameAttribute.index + nameAttribute[1].length + nameAttribute[2].length;
    const valueEnd = valueStart + nameAttribute[3].length;
    return Ok(
      fragmentXml.slice(0, valueStart) + escapeXml(currentName) + fragmentXml.slice(valueEnd),
    );
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
): Promise<Result<unknown, ExecuteCommandError>> {
  switch (kind) {
    case 'worksheet':
      return client.applyWorksheetDocument(id, documentXml, signal);
    case 'dashboard':
      return client.applyDashboardDocument(id, documentXml, signal);
    case 'storyboard':
      return client.applyStoryboardDocument(id, documentXml, signal);
  }
}
