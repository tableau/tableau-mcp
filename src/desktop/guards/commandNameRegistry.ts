import levenshtein from 'fast-levenshtein';

import { listExternalApiCommandNames } from '../externalApi/paramWireRegistry.js';
import { crashPronePolicyFor } from './commandPolicy.js';

const MAX_SUGGESTIONS = 3;

export type CommandValidationResult = { ok: true } | { ok: false; message: string };

/**
 * The known-command set for name validation, sourced from the External API
 * registry (tab-agent-south's live command_param_registry.json, materialized to
 * `TABLEAU_COMMANDS_REGISTRY_DIR`) rather than a bundled snapshot — a snapshot goes
 * stale the moment Desktop ships a new command (e.g. tabdoc:add-local-extension),
 * refusing a real command tableau-mcp never even attempts to send.
 *
 * `null` when no registry is loaded (env unset/unreadable): fail OPEN, same as
 * the historical missing-asset behavior, so a standalone tableau-mcp run without
 * tab-agent-south keeps working with no name check at all. Delegates to
 * `paramWireRegistry`'s own memoized load, so no separate cache is kept here.
 */
export function knownCommands(): Set<string> | null {
  return listExternalApiCommandNames();
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
