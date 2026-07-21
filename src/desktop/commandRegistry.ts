import levenshtein from 'fast-levenshtein';

import { readDataAsset } from './assets.js';
import { crashPronePolicyFor } from './commandPolicy.js';

const COMMANDS_REFERENCE_ASSET = 'tableau-desktop-commands-reference.json';
const MAX_SUGGESTIONS = 3;

type CommandReferenceEntry = {
  fully_qualified_serialized_name?: unknown;
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
        .map((entry: CommandReferenceEntry) => entry.fully_qualified_serialized_name)
        .filter((name): name is string => typeof name === 'string' && name.length > 0),
    );
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
