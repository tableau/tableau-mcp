// One loader for the bundled tableau-desktop-commands-reference.json (~956KB).
// commandNameRegistry.ts, paramContractGuard.ts and search/searchLibrary.ts each project
// their own view from this single memoised read+parse instead of loading the asset
// three times. Failure is cached tri-state like the guards always did: undefined =
// not yet attempted, null = load/parse/shape failure (cached, never retried).

import { readDataAsset } from '../assets.js';

export const COMMANDS_REFERENCE_ASSET = 'tableau-desktop-commands-reference.json';

export type CommandReferenceEntry = {
  fully_qualified_serialized_name?: unknown;
  parameters?: unknown;
  opens_blocking_dialog?: unknown;
};

/**
 * The full parsed reference document. Only `commands` is validated here; top-level
 * routing/allow-list fields (e.g. `command_names_agent_can_invoke`) are read loosely
 * by searchLibrary.
 */
export type CommandsReferenceDocument = {
  commands?: unknown;
} & Record<string, unknown>;

let cache: CommandsReferenceDocument | null | undefined;

/** Memoised full document: null when the asset is missing, unparsable, or has no commands array. */
export function loadCommandsReferenceDocument(): CommandsReferenceDocument | null {
  if (cache !== undefined) {
    return cache;
  }

  try {
    const raw = readDataAsset(COMMANDS_REFERENCE_ASSET);
    if (raw === null) {
      cache = null;
      return cache;
    }

    const parsed = JSON.parse(raw) as CommandsReferenceDocument;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.commands)) {
      cache = null;
      return cache;
    }

    cache = parsed;
    return cache;
  } catch {
    cache = null;
    return cache;
  }
}

/** Memoised command entries: null on any load failure (callers decide fail-open vs throw). */
export function loadCommandsReference(): CommandReferenceEntry[] | null {
  const document = loadCommandsReferenceDocument();
  return document === null ? null : (document.commands as CommandReferenceEntry[]);
}
