import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import {
  externalApiDialogPolicyFor,
  knownLiveFailureFixFor,
} from '../../../desktop/commandPolicy.js';
import { validateKnownCommand } from '../../../desktop/commandRegistry.js';
import {
  ExternalApiCommandRegistryEntry,
  ExternalApiRegistryParam,
  lookupExternalApiCommandRegistry,
} from '../../../desktop/externalApi/commandRegistry.js';
import { validateNotionalSpecArgs } from '../../../desktop/notionalSpecGuard.js';
import { validateCommandParams } from '../../../desktop/paramContractGuard.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import type { ExecuteCommandWarning } from '../../../desktop/toolExecutor/toolExecutor.js';
import { validateUnderlyingMetadataLoad } from '../../../desktop/underlyingMetadataGuard.js';
import { ArgsValidationError, DesktopCommandExecutionError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const LOAD_UNDERLYING_METADATA_COMMAND = 'tabui:load-underlying-metadata';
const CONTEXT_FILLED_PARAM_TYPES = new Set(['UPI_Workspace', 'UPI_IWorkspace']);
const MAX_RESULT_BYTES = 16 * 1024;

const paramsSchema = {
  session: z.string().optional().describe('Session ID; optional if pinned or unique.'),
  command: z.string().describe('namespace:command; use search-commands.'),
  args: z.record(z.any()).optional().describe('JSON command args.'),
};

const title = 'Execute Tableau Command';
export const getExecuteTableauCommandTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'execute-tableau-command',
    title,
    description:
      'Execute a registered Tableau Desktop command. Use search-commands first; format namespace:command.',
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    callback: async ({ session, command, args }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute({
        extra,
        args: { session, command, args },
        callback: async () => {
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }
          const resolvedSession = sessionResult.value;

          const parts = command.split(':');
          if (parts.length !== 2) {
            return new ArgsValidationError(
              `Invalid command format. Expected 'namespace:command' (e.g., 'tabdoc:goto-sheet'), got: ${command}`,
            ).toErr();
          }

          const [namespace, cmd] = parts as ['tabui' | 'tabdoc', string];
          if (namespace !== 'tabui' && namespace !== 'tabdoc') {
            return new ArgsValidationError(
              `Invalid namespace "${namespace}". Expected 'tabui' or 'tabdoc'.`,
            ).toErr();
          }

          const commandValidation = validateKnownCommand(command);
          if (!commandValidation.ok) {
            return new ArgsValidationError(commandValidation.message).toErr();
          }

          // Unconditional: these hang the UI thread headlessly on EVERY deployment
          // (live-observed dialog-poppers that pass the static safety flags), so the
          // refusal cannot depend on the optional registry being installed.
          const externalApiDialogPolicy = externalApiDialogPolicyFor(command);
          if (externalApiDialogPolicy) {
            return new ArgsValidationError(
              formatExternalApiRefusalMessage({
                command,
                reasons: ['live-observed dialog-popper'],
                fix: externalApiDialogPolicy.fix,
              }),
            ).toErr();
          }

          let dispatchArgs = args ?? {};
          let externalApiRegistryWarnings: string[] = [];
          const externalApiCommandRegistry = lookupExternalApiCommandRegistry(namespace, cmd);
          if (externalApiCommandRegistry) {
            const externalApiGuard = validateExternalApiCommandRegistry({
              command,
              args: dispatchArgs,
              registry: externalApiCommandRegistry,
            });
            if (!externalApiGuard.ok) {
              return new ArgsValidationError(externalApiGuard.message).toErr();
            }
            dispatchArgs = externalApiGuard.args;
            externalApiRegistryWarnings = externalApiGuard.warnings;
          } else {
            // No External-API registry loaded/entry found: preserve today's bundled guard behavior.
            const paramValidation = validateCommandParams(command, args);
            if (!paramValidation.ok) {
              return new ArgsValidationError(paramValidation.message).toErr();
            }
          }

          // The deeper NotionalSpec payload guard still runs after param normalization.
          const notionalSpecValidation = validateNotionalSpecArgs(command, dispatchArgs);
          if (!notionalSpecValidation.ok) {
            return new ArgsValidationError(notionalSpecValidation.message).toErr();
          }

          const executor = await extra.getExecutor(resolvedSession);
          if (command === LOAD_UNDERLYING_METADATA_COMMAND) {
            let liveDocumentXml: string | null = null;
            try {
              const liveDocumentResult = await executor.executeCommand({
                namespace: 'tabui',
                command: 'save-underlying-metadata',
                args: {},
                signal: extra.signal,
              });
              if (!liveDocumentResult.isErr()) {
                liveDocumentXml = extractDocumentText(liveDocumentResult.value);
              }
            } catch {
              liveDocumentXml = null;
            }

            const loadValidation = validateUnderlyingMetadataLoad(
              typeof args?.text === 'string' ? args.text : '',
              liveDocumentXml,
            );
            if (!loadValidation.ok) {
              return new ArgsValidationError(loadValidation.message).toErr();
            }
          }

          const result = await executor.executeCommand({
            namespace,
            command: cmd,
            args: dispatchArgs,
            signal: extra.signal,
          });

          if (result.isErr()) {
            return new DesktopCommandExecutionError(
              result.error,
              knownLiveFailureFixFor(command),
            ).toErr();
          }

          const payload = buildSuccessPayload({
            result: result.value.result,
            envelopeWarnings: result.value.warnings ?? [],
            registryWarnings: externalApiRegistryWarnings,
          });

          return new Ok(payload);
        },
      });
    },
  });

  return tool;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

type ExternalApiGuardResult =
  | { ok: true; args: Record<string, unknown>; warnings: string[] }
  | { ok: false; message: string };

type ExecuteTableauCommandSuccess = {
  message: string;
  result?: Record<string, unknown> | string;
  warnings?: ExecuteCommandWarning[];
};

function buildSuccessPayload({
  result,
  envelopeWarnings,
  registryWarnings,
}: {
  result: Record<string, unknown> | null | undefined;
  envelopeWarnings: ExecuteCommandWarning[];
  registryWarnings: string[];
}): ExecuteTableauCommandSuccess {
  const payload: ExecuteTableauCommandSuccess = {
    message: 'Command executed successfully.',
  };

  if (result !== undefined && result !== null) {
    const serialized = JSON.stringify(result, null, 2);
    const totalBytes = Buffer.byteLength(serialized, 'utf-8');
    if (totalBytes > MAX_RESULT_BYTES) {
      const preview = Buffer.from(serialized, 'utf-8').subarray(0, MAX_RESULT_BYTES).toString();
      const previewBytes = Buffer.byteLength(preview, 'utf-8');
      payload.result = `${preview}\n...`;
      payload.message =
        `Command executed successfully. result truncated: ${previewBytes} of ${totalBytes} bytes - ` +
        're-run with a narrower command if you need the rest.';
    } else {
      payload.result = result;
    }
  }

  const warningLines = [
    ...envelopeWarnings.map((warning) => `WARNING: ${warning.code} - ${warning.message}`),
    ...registryWarnings,
  ];
  if (warningLines.length > 0) {
    payload.message = `${payload.message}\n\n${warningLines.join('\n')}`;
  }
  if (envelopeWarnings.length > 0) {
    payload.warnings = envelopeWarnings;
  }

  return payload;
}

function validateExternalApiCommandRegistry({
  command,
  args,
  registry,
}: {
  command: string;
  args: Record<string, unknown>;
  registry: ExternalApiCommandRegistryEntry;
}): ExternalApiGuardResult {
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

function extractDocumentText(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }

  const parsedResult = value.parsedResult;
  if (isRecord(parsedResult) && typeof parsedResult.text === 'string') {
    return parsedResult.text;
  }

  const result = value.result;
  if (isRecord(result) && typeof result.text === 'string') {
    return result.text;
  }

  return typeof result === 'string' ? result : null;
}
