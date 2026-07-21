import { externalApiDialogPolicyFor } from '../commandPolicy.js';
import { validateKnownCommand } from '../commandRegistry.js';
import {
  ExternalApiCommandRegistryEntry,
  ExternalApiRegistryParam,
  lookupExternalApiCommandRegistry,
} from '../externalApi/commandRegistry.js';
import { validateNotionalSpecArgs } from '../notionalSpecGuard.js';
import { validateCommandParams } from '../paramContractGuard.js';

const CONTEXT_FILLED_PARAM_TYPES = new Set(['UPI_Workspace', 'UPI_IWorkspace']);

export type ExternalApiCommandGuardInput = {
  namespace: 'tabui' | 'tabdoc';
  cmd: string;
  command: string;
  args?: Record<string, unknown>;
};

export type ExternalApiCommandGuardResult =
  | { ok: true; dispatchArgs: Record<string, unknown>; warnings: string[] }
  | { refused: true; message: string };

type RegistryGuardResult =
  | { ok: true; args: Record<string, unknown>; warnings: string[] }
  | { ok: false; message: string };

export function guardCommand({
  namespace,
  cmd,
  command,
  args,
}: ExternalApiCommandGuardInput): ExternalApiCommandGuardResult {
  const commandValidation = validateKnownCommand(command);
  if (!commandValidation.ok) {
    return { refused: true, message: commandValidation.message };
  }

  // Unconditional: these hang the UI thread headlessly on EVERY deployment
  // (live-observed dialog-poppers that pass the static safety flags), so the
  // refusal cannot depend on the optional registry being installed.
  const externalApiDialogPolicy = externalApiDialogPolicyFor(command);
  if (externalApiDialogPolicy) {
    return {
      refused: true,
      message: formatExternalApiRefusalMessage({
        command,
        reasons: ['live-observed dialog-popper'],
        fix: externalApiDialogPolicy.fix,
      }),
    };
  }

  let dispatchArgs = args ?? {};
  let warnings: string[] = [];
  const externalApiCommandRegistry = lookupExternalApiCommandRegistry(namespace, cmd);
  if (externalApiCommandRegistry) {
    const externalApiGuard = validateExternalApiCommandRegistry({
      command,
      args: dispatchArgs,
      registry: externalApiCommandRegistry,
    });
    if (!externalApiGuard.ok) {
      return { refused: true, message: externalApiGuard.message };
    }
    dispatchArgs = externalApiGuard.args;
    warnings = externalApiGuard.warnings;
  } else {
    // No External-API registry loaded/entry found: preserve today's bundled guard behavior.
    const paramValidation = validateCommandParams(command, args);
    if (!paramValidation.ok) {
      return { refused: true, message: paramValidation.message };
    }
  }

  // The deeper NotionalSpec payload guard still runs after param normalization.
  const notionalSpecValidation = validateNotionalSpecArgs(command, dispatchArgs);
  if (!notionalSpecValidation.ok) {
    return { refused: true, message: notionalSpecValidation.message };
  }

  return { ok: true, dispatchArgs, warnings };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function validateExternalApiCommandRegistry({
  command,
  args,
  registry,
}: {
  command: string;
  args: Record<string, unknown>;
  registry: ExternalApiCommandRegistryEntry;
}): RegistryGuardResult {
  const externalApiDialogPolicy = externalApiDialogPolicyFor(command);
  if (externalApiDialogPolicy || !registry.invocable || registry.blockingDialog) {
    const reasons = [
      externalApiDialogPolicy ? 'live-observed dialog-popper' : undefined,
      !registry.invocable ? 'agent_can_invoke=false' : undefined,
      registry.blockingDialog ? 'opens_blocking_dialog=true' : undefined,
    ].filter((reason): reason is string => reason !== undefined);
    return {
      ok: false,
      message: formatExternalApiRefusalMessage({
        command,
        reasons,
        fix: externalApiDialogPolicy?.fix,
      }),
    };
  }

  const providedArgs = isRecord(args) ? args : {};
  const rewrittenArgs: Record<string, unknown> = {};
  const warnings: string[] = [];

  for (const [key, value] of Object.entries(providedArgs)) {
    const param = findExternalApiParam(registry, key);
    if (!param) {
      rewrittenArgs[key] = value;
      // The External Client API still surfaces some unknown command params as bare 500s;
      // the command-registry guard remains the client-side defense.
      warnings.push(
        `WARNING: key "${key}" is not in the command registry - a wrong name surfaces as a bare 500.`,
      );
      continue;
    }

    const enumValues = registry.enumValuesForParamType.get(param.type);
    if (enumValues && !enumValues.includes(String(value))) {
      return {
        ok: false,
        message:
          `Invalid value for Tableau command "${command}" parameter "${param.wire}": ` +
          `${JSON.stringify(value)}. Legal values: ${formatLegalValues(enumValues)}.`,
      };
    }

    rewrittenArgs[param.wire] = value;
  }

  const missingRequired = registry.requiredParams.filter(
    (param) => !isContextFilledParam(param) && !hasExternalApiParam(providedArgs, param),
  );
  if (missingRequired.length > 0) {
    return {
      ok: false,
      message:
        `Missing required parameter(s) for Tableau command "${command}": ` +
        `${missingRequired.map((param) => param.wire).join(', ')}. NOT sent. ` +
        'Registry-required UPI_Workspace/UPI_IWorkspace params are context-filled by the active sheet/workspace and are skipped.',
    };
  }

  return { ok: true, args: rewrittenArgs, warnings };
}

function findExternalApiParam(
  registry: ExternalApiCommandRegistryEntry,
  key: string,
): ExternalApiRegistryParam | null {
  return (
    registry.params.find(
      (param) => key === param.local || key === param.camelToDashed || key === param.wire,
    ) ?? null
  );
}

function hasExternalApiParam(
  args: Record<string, unknown>,
  param: ExternalApiRegistryParam,
): boolean {
  return (
    Object.prototype.hasOwnProperty.call(args, param.local) ||
    Object.prototype.hasOwnProperty.call(args, param.camelToDashed) ||
    Object.prototype.hasOwnProperty.call(args, param.wire)
  );
}

function isContextFilledParam(param: ExternalApiRegistryParam): boolean {
  return CONTEXT_FILLED_PARAM_TYPES.has(param.type);
}

function formatExternalApiRefusalMessage({
  command,
  reasons,
  fix,
}: {
  command: string;
  reasons: string[];
  fix?: string;
}): string {
  return (
    `Refusing Tableau command "${command}" because it would open a human-blocking dialog ` +
    `in Tableau Desktop (${reasons.join(', ')}). NOT sent. FIX: ` +
    `${fix ?? 'use a supported headless authoring alternative or ask a human to drive the dialog.'}`
  );
}

function formatLegalValues(values: string[]): string {
  const displayed = values.slice(0, 15);
  const suffix =
    values.length > displayed.length ? `, ... (+${values.length - displayed.length} more)` : '';
  return `${displayed.join(', ')}${suffix}`;
}
