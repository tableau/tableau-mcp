// Agent-side command PARAMETER guard — bad param shapes never reach Desktop.
//
// Live incident (2026-07-19, on the user's screen, twice): a model invoked
// tabdoc:goto-sheet through execute-tableau-command with a fabricated param
// key. Tableau does not fail this silently — it pops a BLOCKING modal error
// dialog ("Error in parameters for command 'goto-sheet' — bad value: sheet —
// Error Code: 47BF7751"), and a stuck-open modal can fail every subsequent
// command until a human dismisses it. commandRegistry.ts already refuses an
// UNKNOWN COMMAND VERB; this guard is the companion check one level down —
// it refuses a KNOWN command called with the WRONG PARAM SHAPE, using the
// same bundled reference's per-command `parameters[]` contract:
//   - an "in" param name not present on the command's contract -> rejected,
//     naming the offending key and listing the valid ones
//   - a "required": true "in" param missing from the call -> rejected,
//     naming the missing key(s)
// Commands the reference flags via `opens_blocking_dialog: true` get a
// stricter message on either rejection, since a bad call to one of THESE is
// exactly the class of failure that interrupts the user with a modal.
//
// A command with a KNOWN contract but ZERO declared "in" params (e.g.
// tabdoc:generate-viz-from-notional-spec — pane-invoked commands are dropped
// by the reference's parameter-extraction pass, see its provenance_note) has
// no positive list to validate keys against, so the unknown-key check is
// skipped for it; the deeper NotionalSpec payload guard is the one that
// validates that command's actual shape.

import { readDataAsset } from './assets.js';
import {
  checkCommandPolicy,
  formatUnvalidatedTargetRefusal,
  liveDialogPolicyFor,
  liveParamOverrideFor,
  unvalidatedTargetPolicyFor,
} from './commandPolicy.js';
import type { CommandValidationResult } from './commandRegistry.js';

const COMMANDS_REFERENCE_ASSET = 'tableau-desktop-commands-reference.json';

type CommandParameter = {
  direction?: unknown;
  local_name?: unknown;
  required?: unknown;
  comment?: unknown;
};

type CommandReferenceEntry = {
  fully_qualified_serialized_name?: unknown;
  parameters?: unknown;
  opens_blocking_dialog?: unknown;
};

type CommandReference = {
  commands?: unknown;
};

let commandsByNameCache: Map<string, CommandReferenceEntry> | null | undefined;

function commandsByName(): Map<string, CommandReferenceEntry> | null {
  if (commandsByNameCache !== undefined) {
    return commandsByNameCache;
  }

  try {
    const raw = readDataAsset(COMMANDS_REFERENCE_ASSET);
    if (raw === null) {
      commandsByNameCache = null;
      return commandsByNameCache;
    }

    const reference = JSON.parse(raw) as CommandReference;
    if (!reference || typeof reference !== 'object' || !Array.isArray(reference.commands)) {
      commandsByNameCache = null;
      return commandsByNameCache;
    }

    const map = new Map<string, CommandReferenceEntry>();
    for (const entry of reference.commands as CommandReferenceEntry[]) {
      const fq = entry?.fully_qualified_serialized_name;
      if (typeof fq === 'string' && fq.length > 0) {
        map.set(fq, entry);
      }
    }
    commandsByNameCache = map;
    return commandsByNameCache;
  } catch {
    commandsByNameCache = null;
    return commandsByNameCache;
  }
}

function inParams(entry: CommandReferenceEntry): CommandParameter[] {
  if (!Array.isArray(entry.parameters)) {
    return [];
  }
  return (entry.parameters as CommandParameter[]).filter(
    (param): param is CommandParameter => param?.direction === 'in',
  );
}

function localName(param: CommandParameter): string | null {
  return typeof param.local_name === 'string' && param.local_name.length > 0
    ? param.local_name
    : null;
}

function formatParam(param: CommandParameter): string {
  const name = localName(param) ?? '(unnamed)';
  const required = param.required === true ? 'true' : 'false';
  const comment =
    typeof param.comment === 'string' && param.comment.trim() ? ` - ${param.comment.trim()}` : '';
  return `${name} (required: ${required})${comment}`;
}

function blockingDialogNote(entry: CommandReferenceEntry): string {
  return entry.opens_blocking_dialog === true
    ? ' This command is flagged opens_blocking_dialog=true — a wrong call here pops a blocking modal error ' +
        "dialog on the user's screen (and a stuck-open modal can fail subsequent commands too)."
    : '';
}

export function validateCommandParams(
  command: string,
  args: Record<string, unknown> | undefined,
): CommandValidationResult {
  const unvalidatedTargetPolicy = unvalidatedTargetPolicyFor(command);
  if (unvalidatedTargetPolicy) {
    return {
      ok: false,
      message: formatUnvalidatedTargetRefusal(command, unvalidatedTargetPolicy),
    };
  }

  const dialogPolicy = liveDialogPolicyFor(command);
  if (dialogPolicy?.fix !== undefined) {
    return {
      ok: false,
      message:
        `Tableau command "${command}" opens a BLOCKING dialog/modal on the user's screen when called ` +
        'headlessly (live-proven; the reference misclassifies it as safe). NOT sent. ' +
        `FIX: ${dialogPolicy.fix}.`,
    };
  }

  const override = liveParamOverrideFor(command);
  if (override) {
    const policy = checkCommandPolicy(command);
    const providedArgs = args && typeof args === 'object' ? args : {};
    const providedKeys = Object.keys(providedArgs);
    const unknownKeys = providedKeys.filter((key) => !override.allowed.has(key));
    if (unknownKeys.length > 0) {
      return {
        ok: false,
        message:
          `Unknown parameter(s) for Tableau command "${command}": ${unknownKeys.join(', ')}. NOT sent — ` +
          "a wrong parameter for this command pops a blocking error dialog on the user's screen " +
          `(live-verified 2026-07-19).${formatUnknownOverrideFix(policy, override)}`,
      };
    }
    const missing = [...override.required].filter((key) => !(key in providedArgs));
    if (missing.length > 0) {
      return {
        ok: false,
        message:
          `Missing required parameter(s) for Tableau command "${command}": ${missing.join(', ')}. ` +
          formatMissingOverrideFix(policy, missing),
      };
    }
    return { ok: true };
  }

  const commands = commandsByName();
  if (commands === null) {
    return { ok: true };
  }

  const entry = commands.get(command);
  if (!entry) {
    return { ok: true };
  }

  const expected = inParams(entry);
  if (expected.length === 0) {
    return { ok: true };
  }

  const expectedNames = new Set(
    expected.map(localName).filter((name): name is string => name !== null),
  );
  const providedArgs = args && typeof args === 'object' ? args : {};
  const providedKeys = Object.keys(providedArgs);

  const unknownKeys = providedKeys.filter((key) => !expectedNames.has(key));
  if (unknownKeys.length > 0) {
    return {
      ok: false,
      message:
        `Unknown parameter(s) for Tableau command "${command}": ${unknownKeys.join(', ')}. NOT sent, to avoid ` +
        `a Tableau Desktop parameter-error dialog.${blockingDialogNote(entry)} Valid "in" params: ` +
        `${expected.map(formatParam).join('; ')}. FIX: use one of the valid param names above.`,
    };
  }

  const required = expected.filter((param) => param.required === true);
  const missing = required.filter((param) => {
    const name = localName(param);
    return name !== null && !Object.prototype.hasOwnProperty.call(providedArgs, name);
  });

  if (missing.length > 0) {
    const missingNames = missing.map((param) => localName(param)).join(', ');
    return {
      ok: false,
      message:
        `Missing required parameter(s) for Tableau command "${command}": ${missingNames}. NOT sent, to avoid ` +
        `a Tableau Desktop parameter-error dialog.${blockingDialogNote(entry)} Expected "in" params: ` +
        `${expected.map(formatParam).join('; ')}. FIX: provide the missing param(s) above.`,
    };
  }

  return { ok: true };
}

function formatUnknownOverrideFix(
  policy: ReturnType<typeof checkCommandPolicy>,
  override: { allowed: Set<string> },
): string {
  const allowed = [...override.allowed].map((key) => `"${key}"`).join(', ');
  if (policy?.action === 'hint' && policy.fix) {
    return (
      ` Live-verified /v0 contract allows exactly ${allowed}; ` +
      `the bundled reference's declared params are wrong for this command. ${policy.fix}`
    );
  }
  return (
    ` FIX: use exactly ${allowed} ` +
    "(the live-verified /v0 contract; the bundled reference's declared params are wrong for this command)."
  );
}

function formatMissingOverrideFix(
  policy: ReturnType<typeof checkCommandPolicy>,
  missing: string[],
): string {
  const missingParams = missing.map((key) => `"${key}"`).join(', ');
  if (policy?.action === 'hint' && policy.fix) {
    return `Live-verified /v0 contract requires ${missingParams}. ${policy.fix}`;
  }
  return `FIX: provide ${missingParams} (live-verified /v0 contract).`;
}
