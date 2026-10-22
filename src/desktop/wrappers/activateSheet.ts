import type {
  ExecuteCommandError,
  WithExecutorAndAbortSignal,
} from '../externalApi/executorTypes.js';
import { resolveItemByNameOrId } from '../externalApi/toolUtils.js';
import type { WorkbookInventory } from '../externalApi/types.js';
import { withApplyLock } from './applyMutex.js';

export type ActivateSheetResult =
  | { status: 'activated'; previousSheet?: string; availableSheets: string[] }
  | { status: 'already-active'; previousSheet: string; availableSheets: string[] }
  | { status: 'not-found'; availableSheets: string[] }
  | { status: 'read-failed'; error: ExecuteCommandError }
  | { status: 'command-failed'; error: ExecuteCommandError };

export type ResolveSheetIdResult =
  | { status: 'resolved'; sheetId: string }
  | Extract<ActivateSheetResult, { status: 'not-found' | 'read-failed' }>;

type InventorySheet = { id: string; name: string; isActiveSheet?: boolean };

function inventorySheets(inventory: WorkbookInventory): InventorySheet[] {
  return [
    ...(inventory.worksheets ?? []),
    ...(inventory.dashboards ?? []),
    ...(inventory.storyboards ?? []),
  ];
}

function sheetNames(sheets: InventorySheet[]): string[] {
  return Array.from(new Set(sheets.map(({ name }) => name)));
}

/** Resolves a sheet name to its id from a fresh workbook inventory. */
export async function resolveSheetId({
  sheetName,
  executor,
  signal,
}: {
  sheetName: string;
} & WithExecutorAndAbortSignal): Promise<ResolveSheetIdResult> {
  const inventoryResult = await executor.getWorkbook(signal);
  if (inventoryResult.isErr()) {
    return { status: 'read-failed', error: inventoryResult.error };
  }

  const sheets = inventorySheets(inventoryResult.value);
  const match = resolveItemByNameOrId('Sheet', sheetName, sheets);
  if (match.isErr()) {
    return { status: 'not-found', availableSheets: sheetNames(sheets) };
  }

  return { status: 'resolved', sheetId: match.value.id };
}

/**
 * Internal navigation path sanctioned only after a fresh workbook read confirms the id. It goes
 * through the goToSheet API route, so a stale or unknown sheet can never reach Desktop.
 *
 * Lock-free: the post-apply focus dispatch already holds the apply lock, and withApplyLock
 * is a promise chain rather than a reentrant mutex, so taking it again from in there would
 * deadlock. Callers that are not already holding the lock use activateSheetWithValidatedGoto.
 */
export async function activateSheetValidated({
  sheetId,
  executor,
  signal,
}: {
  sheetId: string;
} & WithExecutorAndAbortSignal): Promise<ActivateSheetResult> {
  const inventoryResult = await executor.getWorkbook(signal);
  if (inventoryResult.isErr()) {
    return { status: 'read-failed', error: inventoryResult.error };
  }

  const sheets = inventorySheets(inventoryResult.value);
  const availableSheets = sheetNames(sheets);
  const sheet = sheets.find((candidate) => candidate.id === sheetId);
  if (!sheet) {
    return { status: 'not-found', availableSheets };
  }

  // Already there: skip the dispatch. Navigating records an undo entry, so a redundant
  // one costs the user their first Cmd-Z.
  if (sheet.isActiveSheet) {
    return { status: 'already-active', previousSheet: sheet.name, availableSheets };
  }

  const commandResult = await executor.goToSheet(sheetId, signal);
  if (commandResult.isErr()) {
    return { status: 'command-failed', error: commandResult.error };
  }

  return {
    status: 'activated',
    previousSheet: sheets.find((candidate) => candidate.isActiveSheet)?.name,
    availableSheets,
  };
}

/** The same validated navigation, serialized against in-flight applies. */
export async function activateSheetWithValidatedGoto(
  params: { sheetId: string } & WithExecutorAndAbortSignal,
): Promise<ActivateSheetResult> {
  return await withApplyLock(() => activateSheetValidated(params));
}
