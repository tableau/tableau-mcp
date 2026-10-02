// One loader for the commands-reference document consumed by commandNameRegistry.ts (name
// guard) and search/searchLibrary.ts (search-commands). Synthesized from tab-agent-south's
// live External API registry (paramWireRegistry.ts's `listExternalApiCommandRegistryEntries`)
// rather than a bundled JSON snapshot — a snapshot goes stale the moment Desktop ships a new
// command. Memoised tri-state like the guards always did: undefined = not yet attempted, null
// = no registry loaded (env unset/unreadable), cached and never retried until
// `_resetExternalApiCommandRegistryForTest`.

import {
  type ExternalApiCommandRegistryEntry,
  listExternalApiCommandRegistryEntries,
} from '../externalApi/paramWireRegistry.js';

export type CommandReferenceEntry = {
  fully_qualified_serialized_name?: unknown;
  command_name?: unknown;
  parameters?: unknown;
  agent_can_invoke?: unknown;
  opens_blocking_dialog?: unknown;
  modifies_workbook_state?: unknown;
  description?: unknown;
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

/**
 * Clears this module's own memoised document, independent of `paramWireRegistry`'s cache —
 * tests that swap `TABLEAU_COMMANDS_REGISTRY_DIR` between cases need both reset, since a dynamic
 * `import('./commandsReference.js')` resolves to the same cached module instance across every
 * test in a file unless `vi.resetModules()` is called.
 */
export function _resetCommandsReferenceForTest(): void {
  cache = undefined;
}

/** Memoised full document: null when no External API registry is loaded this run. */
export function loadCommandsReferenceDocument(): CommandsReferenceDocument | null {
  if (cache !== undefined) {
    return cache;
  }

  const entries = listExternalApiCommandRegistryEntries();
  if (entries === null) {
    cache = null;
    return cache;
  }

  cache = { commands: [...entries.entries()].map(toReferenceEntry) };
  return cache;
}

/** Memoised command entries: null on any load failure (callers decide fail-open vs throw). */
export function loadCommandsReference(): CommandReferenceEntry[] | null {
  const document = loadCommandsReferenceDocument();
  return document === null ? null : (document.commands as CommandReferenceEntry[]);
}

function toReferenceEntry([fullyQualifiedSerializedName, entry]: readonly [
  string,
  ExternalApiCommandRegistryEntry,
]): CommandReferenceEntry {
  return {
    fully_qualified_serialized_name: fullyQualifiedSerializedName,
    command_name: fullyQualifiedSerializedName.split(':').slice(1).join(':'),
    agent_can_invoke: entry.invocable,
    opens_blocking_dialog: entry.blockingDialog,
    modifies_workbook_state: entry.modifiesWorkbookState,
    description: entry.description,
    parameters: entry.params.map((param) => ({
      direction: 'in',
      local_name: param.local,
      type_id: param.type,
      required: param.required,
      cannot_provide_from_mcp: param.unprovidable,
      context_filled: param.contextFilled,
      comment: param.comment,
    })),
  };
}
