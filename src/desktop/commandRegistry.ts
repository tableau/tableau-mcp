import levenshtein from 'fast-levenshtein';

import { readDataAsset } from './assets.js';
import { crashPronePolicyFor } from './commandPolicy.js';
import { GENERATE_VIZ_FROM_NOTIONAL_SPEC_COMMAND } from './notionalSpecGuard.js';

const COMMANDS_REFERENCE_ASSET = 'tableau-desktop-commands-reference.json';
const MAX_SUGGESTIONS = 3;

// Commands that are executable but which the codegen reference's extraction pass omits
// (pane-invoked commands have no serialized parameter contract, so they are filtered out
// during generation). They are still real, dispatchable verbs with their own dedicated
// payload guards, so the known-command guard must not reject them as hallucinated. The
// notional-spec command carries its own NotionalSpec payload guard (see notionalSpecGuard).
const REFERENCE_OMITTED_EXECUTABLE_COMMANDS: readonly string[] = [
  GENERATE_VIZ_FROM_NOTIONAL_SPEC_COMMAND,
];

type CommandReferenceEntry = {
  // Nested-schema shape (tableau-desktop-commands-reference.json): the fully-qualified
  // serialized name lives under `serialized.fully_qualified_name`.
  serialized?: { fully_qualified_name?: unknown };
};

type CommandReference = {
  commands?: unknown;
};

export type CommandValidationResult = { ok: true } | { ok: false; message: string };

let knownCommandsCache: Set<string> | null | undefined;

export function knownCommands(): Set<string> | null {
  if (knownCommandsCache !== undefined) {
    return knownCommandsCache;
  }

  try {
    const raw = readDataAsset(COMMANDS_REFERENCE_ASSET);
    if (raw === null) {
      knownCommandsCache = null;
      return knownCommandsCache;
    }

    const reference = JSON.parse(raw) as CommandReference;
    if (!reference || typeof reference !== 'object' || !Array.isArray(reference.commands)) {
      knownCommandsCache = null;
      return knownCommandsCache;
    }

    knownCommandsCache = new Set(
      (reference.commands as CommandReferenceEntry[])
        .map((entry: CommandReferenceEntry) => entry.serialized?.fully_qualified_name)
        .filter((name): name is string => typeof name === 'string' && name.length > 0),
    );
    // Union in the executable commands the codegen reference filters out (pane-invoked),
    // so the fail-closed guard doesn't reject a real, dispatchable verb.
    for (const command of REFERENCE_OMITTED_EXECUTABLE_COMMANDS) {
      knownCommandsCache.add(command);
    }
    return knownCommandsCache;
  } catch {
    knownCommandsCache = null;
    return knownCommandsCache;
  }
}

export function validateKnownCommand(command: string): CommandValidationResult {
  if (crashPronePolicyFor(command)) {
    return {
      ok: false,
      message: `Refusing to execute crash-prone Tableau command "${command}".`,
    };
  }

  const commands = knownCommands();
  if (commands === null || commands.has(command)) {
    return { ok: true };
  }

  const suggestions = suggestionsFor(command, commands);
  const suggestionText = suggestions.length > 0 ? ` Did you mean: ${suggestions.join(', ')}?` : '';
  return {
    ok: false,
    message: `Unknown Tableau command "${command}".${suggestionText}`,
  };
}

function suggestionsFor(command: string, commands: Set<string>): string[] {
  const normalizedCommand = command.toLowerCase();
  return [...commands]
    .map((candidate) => ({
      candidate,
      distance: levenshtein.get(normalizedCommand, candidate.toLowerCase()),
    }))
    .sort((a, b) => a.distance - b.distance || a.candidate.localeCompare(b.candidate))
    .slice(0, MAX_SUGGESTIONS)
    .map(({ candidate }) => candidate);
}
