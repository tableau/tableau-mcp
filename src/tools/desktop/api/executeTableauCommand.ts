import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, type Result } from 'ts-results-es';
import { z } from 'zod';

import type { ExecuteCommandWarning } from '../../../desktop/externalApi/executorTypes.js';
import type { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import { lookupExternalApiCommandRegistry } from '../../../desktop/externalApi/paramWireRegistry.js';
import type { DatasourceItem } from '../../../desktop/externalApi/types.js';
import { guardCommand } from '../../../desktop/guards/commandGuard.js';
import { knownLiveFailureFixFor } from '../../../desktop/guards/commandPolicy.js';
import { resolveSession } from '../../../desktop/session/sessionResolution.js';
import type { ReadbackVerificationResult } from '../../../desktop/validation/readback-verify.js';
import {
  checkUsedFieldValidity,
  mergeUsedFieldValidityVerification,
  type UsedFieldValidityOutcome,
} from '../../../desktop/validation/usedFieldValidity.js';
import { withApplyLock } from '../../../desktop/wrappers/applyMutex.js';
import {
  ArgsValidationError,
  DesktopCommandExecutionError,
  McpToolError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const MAX_RESULT_BYTES = 16 * 1024;

const paramsSchema = {
  session: z.string().optional().describe('Session ID; optional if pinned or unique.'),
  command: z.string().describe('Command ID from the command search results.'),
  args: z.record(z.any()).optional().describe('JSON command args.'),
};

const title = 'Running command';
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
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    callback: async ({ session, command, args }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute({
        extra,
        args: { session, command, args },
        callback: async (): Promise<Result<ExecuteTableauCommandSuccess, McpToolError>> => {
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }
          const resolvedSession = sessionResult.value;

          const parts = command.split(':');
          if (parts.length !== 2) {
            return new ArgsValidationError(
              `Invalid command format. Expected 'namespace:command' (e.g., 'tabdoc:save'), got: ${command}`,
            ).toErr();
          }

          const [namespace, cmd] = parts as ['tabui' | 'tabdoc', string];
          if (namespace !== 'tabui' && namespace !== 'tabdoc') {
            return new ArgsValidationError(
              `Invalid namespace "${namespace}". Expected 'tabui' or 'tabdoc'.`,
            ).toErr();
          }

          const commandGuard = guardCommand({ namespace, cmd, command, args });
          if ('refused' in commandGuard) {
            return new ArgsValidationError(commandGuard.message).toErr();
          }
          const { dispatchArgs, warnings: commandGuardWarnings } = commandGuard;

          return await withApplyLock(async () => {
            const executor = await extra.getExecutor(resolvedSession);
            const verifyRootFileConnection = shouldVerifyRootFileConnection(command, dispatchArgs);
            const worksheetTarget = verifyRootFileConnection
              ? null
              : commandWorksheetTarget(namespace, cmd, dispatchArgs);
            const expectedInstanceId = worksheetTarget ? executor.desktopInstanceId : undefined;
            const targetBefore = worksheetTarget
              ? await resolveCommandWorksheetTarget(executor, worksheetTarget, extra.signal)
              : undefined;
            let datasourcesBefore: DatasourceItem[] = [];
            if (verifyRootFileConnection) {
              const beforeResult = await executor.listWorkbookDatasources(extra.signal);
              if (beforeResult.isErr()) {
                return commandPostconditionError(
                  'Cannot verify a new workbook datasource because the current datasource inventory could not be read. The command was not sent.',
                ).toErr();
              }
              datasourcesBefore = beforeResult.value.datasources ?? [];
            }

            const result = await executor.executeCommand({
              namespace,
              command: cmd,
              args: dispatchArgs,
              signal: extra.signal,
              expectedInstanceId,
            });

            if (result.isErr()) {
              return new DesktopCommandExecutionError(
                result.error,
                knownLiveFailureFixFor(command),
              ).toErr();
            }

            if (result.value.status === 'queued' || result.value.status === 'running') {
              const pendingVerification = worksheetTarget
                ? mergeUsedFieldValidityVerification(undefined, {
                    status: 'unknown',
                    worksheetId:
                      targetBefore?.status === 'resolved' ? targetBefore.worksheetId : undefined,
                    reason: 'operation-pending',
                    message:
                      'Field verification was not checked because the command has not completed.',
                  })
                : undefined;
              return new Ok({
                message: `Command is still ${result.value.status}; state is not complete. Do not retry automatically.`,
                command_id: result.value.command_id,
                status: result.value.status,
                ...(pendingVerification ? { verification: pendingVerification } : {}),
              });
            }

            let verification: DatasourceVerification | undefined;
            let worksheetVerification: ReadbackVerificationResult | undefined;
            if (verifyRootFileConnection) {
              const afterResult = await executor.listWorkbookDatasources(extra.signal);
              if (afterResult.isErr()) {
                return commandPostconditionError(
                  'Desktop accepted the connection command, but datasource readback failed; state may have changed. Inspect workbook datasources and do not retry automatically.',
                ).toErr();
              }
              const addedDatasources = findAddedDatasources(
                datasourcesBefore,
                afterResult.value.datasources ?? [],
              );
              if (addedDatasources.length === 0) {
                return commandPostconditionError(
                  'Desktop reported success, but no new workbook datasource appeared. The command may have had no effect; inspect workbook datasources before retrying.',
                ).toErr();
              }
              verification = { status: 'passed', addedDatasources };
            }
            if (worksheetTarget) {
              let validity: UsedFieldValidityOutcome;
              if (!expectedInstanceId) {
                validity = {
                  status: 'unknown',
                  reason: 'instance-unavailable',
                  message:
                    'Field verification was not checked because the applied Desktop instance was unavailable.',
                };
              } else if (!targetBefore || targetBefore.status === 'unknown') {
                validity = targetBefore ?? {
                  status: 'unknown',
                  reason: 'target-unresolved',
                  message:
                    'Field verification was not checked because the worksheet target was unresolved.',
                };
              } else if (worksheetTarget.kind === 'active') {
                const activeAfter = await resolveCommandWorksheetTarget(
                  executor,
                  worksheetTarget,
                  extra.signal,
                );
                validity =
                  activeAfter.status === 'resolved' &&
                  activeAfter.worksheetId === targetBefore.worksheetId
                    ? await checkUsedFieldValidity({
                        executor,
                        worksheetId: targetBefore.worksheetId,
                        expectedInstanceId,
                        signal: extra.signal,
                      })
                    : {
                        status: 'unknown',
                        worksheetId: targetBefore.worksheetId,
                        reason: 'target-changed',
                        message:
                          'Field verification was not checked because the active worksheet changed during the command.',
                      };
              } else {
                validity = await checkUsedFieldValidity({
                  executor,
                  worksheetId: targetBefore.worksheetId,
                  expectedInstanceId,
                  signal: extra.signal,
                });
              }
              worksheetVerification = mergeUsedFieldValidityVerification(undefined, validity);
            }

            const payload = shapeCommandResult({
              result: result.value.result,
              envelopeWarnings: result.value.warnings ?? [],
              guardWarnings: commandGuardWarnings,
              verification,
              worksheetVerification,
            });

            return new Ok(payload);
          });
        },
        getSuccessResult: (payload): CallToolResult => ({
          isError: hasOutputSerializationFailed(payload),
          content: [{ type: 'text', text: JSON.stringify(payload) }],
        }),
      });
    },
  });

  return tool;
};

type ExecuteTableauCommandSuccess = {
  message: string;
  command_id?: string;
  status?: 'queued' | 'running';
  result?: Record<string, unknown> | string;
  warnings?: ExecuteCommandWarning[];
  verification?: DatasourceVerification | ReadbackVerificationResult;
};

type DatasourceVerification = {
  status: 'passed';
  addedDatasources: VerifiedDatasource[];
};

type VerifiedDatasource = Pick<DatasourceItem, 'id' | 'luid' | 'name' | 'caption'>;

function shapeCommandResult({
  result,
  envelopeWarnings,
  guardWarnings,
  verification,
  worksheetVerification,
}: {
  result: Record<string, unknown> | null | undefined;
  envelopeWarnings: ExecuteCommandWarning[];
  guardWarnings: string[];
  verification?: DatasourceVerification;
  worksheetVerification?: ReadbackVerificationResult;
}): ExecuteTableauCommandSuccess {
  const outputSerializationFailed = envelopeWarnings.some(
    (warning) => warning.code === 'output-serialization-failed',
  );
  const payload: ExecuteTableauCommandSuccess = {
    message: outputSerializationFailed
      ? 'Command executed, but the requested result cannot be returned because Desktop reported output serialization failed; the command executed; state may have changed; do NOT retry - re-read state instead.'
      : verification
        ? 'Command executed successfully and the new workbook datasource was verified.'
        : 'Command executed successfully.',
  };

  if (verification) {
    payload.verification = verification;
  }
  if (worksheetVerification) {
    payload.verification = worksheetVerification;
    if (worksheetVerification.status === 'failed') {
      payload.message =
        'Command executed successfully, but field verification found invalid worksheet state. Diagnose the listed fields; do not retry the command automatically.';
    } else if (worksheetVerification.status === 'skipped') {
      payload.message =
        'Command executed successfully, but field verification was unavailable. State may have changed; do not retry automatically.';
    }
  }

  if (result !== undefined && result !== null) {
    const serialized = JSON.stringify(result, null, 2);
    const totalBytes = Buffer.byteLength(serialized, 'utf-8');
    if (totalBytes > MAX_RESULT_BYTES) {
      const preview = Buffer.from(serialized, 'utf-8').subarray(0, MAX_RESULT_BYTES).toString();
      const previewBytes = Buffer.byteLength(preview, 'utf-8');
      payload.result = `${preview}\n...`;
      if (!worksheetVerification) {
        payload.message =
          `Command executed successfully. result truncated: ${previewBytes} of ${totalBytes} bytes - ` +
          're-run with a narrower command if you need the rest.';
      }
    } else {
      payload.result = result;
    }
  }

  const warningLines = [
    ...envelopeWarnings.map((warning) => `WARNING: ${warning.code} - ${warning.message}`),
    ...guardWarnings,
  ];
  if (warningLines.length > 0) {
    payload.message = `${payload.message}\n\n${warningLines.join('\n')}`;
  }
  if (envelopeWarnings.length > 0) {
    payload.warnings = envelopeWarnings;
  }

  return payload;
}

type CommandWorksheetTarget =
  | { kind: 'active' }
  | { kind: 'explicit'; worksheetRef: string }
  | { kind: 'unknown' };

function commandWorksheetTarget(
  namespace: 'tabui' | 'tabdoc',
  command: string,
  dispatchArgs: Record<string, unknown>,
): CommandWorksheetTarget | null {
  if (`${namespace}:${command}` === 'tabdoc:generate-viz-from-notional-spec') {
    return { kind: 'active' };
  }
  const registry = lookupExternalApiCommandRegistry(namespace, command);
  if (!registry?.modifiesWorkbookState) return null;
  const worksheetParams = registry.params.filter((param) => param.type === 'DPI_Worksheet');
  if (worksheetParams.length !== 1) return { kind: 'unknown' };
  const worksheetParam = worksheetParams[0]!;
  const value = dispatchArgs[worksheetParam.wire];
  return typeof value === 'string' && value.trim()
    ? { kind: 'explicit', worksheetRef: value.trim() }
    : { kind: 'unknown' };
}

async function resolveCommandWorksheetTarget(
  executor: ExternalApiToolExecutor,
  target: CommandWorksheetTarget,
  signal: AbortSignal,
): Promise<
  | { status: 'resolved'; worksheetId: string }
  | { status: 'unknown'; reason: string; message: string }
> {
  if (target.kind === 'unknown') {
    return {
      status: 'unknown',
      reason: 'target-unresolved',
      message:
        'Field verification was not checked because this command has no proven worksheet target.',
    };
  }
  try {
    const result = await executor.listWorksheets(signal);
    if (result.isErr()) throw result.error;
    const worksheets = result.value.worksheets ?? [];
    if (target.kind === 'active') {
      const active = worksheets.filter((worksheet) => worksheet.isActiveSheet);
      return active.length === 1
        ? { status: 'resolved', worksheetId: active[0]!.id }
        : {
            status: 'unknown',
            reason: 'target-unresolved',
            message:
              'Field verification was not checked because the active worksheet was not unique.',
          };
    }
    const matches = worksheets.filter(
      (worksheet) => worksheet.id === target.worksheetRef || worksheet.name === target.worksheetRef,
    );
    return matches.length === 1
      ? { status: 'resolved', worksheetId: matches[0]!.id }
      : {
          status: 'unknown',
          reason: 'target-unresolved',
          message: `Field verification was not checked because worksheet ${target.worksheetRef} could not be resolved uniquely.`,
        };
  } catch {
    return {
      status: 'unknown',
      reason: 'target-read-failed',
      message: 'Field verification was not checked because worksheet inventory could not be read.',
    };
  }
}

function hasOutputSerializationFailed(payload: ExecuteTableauCommandSuccess): boolean {
  return (
    payload.warnings?.some((warning) => warning.code === 'output-serialization-failed') ?? false
  );
}

function shouldVerifyRootFileConnection(
  command: string,
  dispatchArgs: Record<string, unknown>,
): boolean {
  if (command !== 'tabui:data-catalog-connect-to-file') return false;
  return ['IsLeafConnection', 'is-leaf-connection', 'is-leaf-connection-ui'].some(
    (key) => dispatchArgs[key] === false,
  );
}

function findAddedDatasources(
  before: DatasourceItem[],
  after: DatasourceItem[],
): VerifiedDatasource[] {
  const beforeIds = new Set(
    before.map(datasourceIdentity).filter((id): id is string => id !== null),
  );
  return after
    .filter((datasource) => {
      const identity = datasourceIdentity(datasource);
      return identity !== null && !beforeIds.has(identity);
    })
    .map(projectDatasource);
}

function datasourceIdentity(datasource: DatasourceItem): string | null {
  if (datasource.id) return `id:${datasource.id}`;
  if (datasource.luid) return `luid:${datasource.luid}`;
  if (datasource.name || datasource.caption) {
    return `name:${datasource.name ?? ''}|caption:${datasource.caption ?? ''}`;
  }
  return null;
}

function projectDatasource(datasource: DatasourceItem): VerifiedDatasource {
  return {
    ...(datasource.id ? { id: datasource.id } : {}),
    ...(typeof datasource.luid === 'string' ? { luid: datasource.luid } : {}),
    ...(datasource.name ? { name: datasource.name } : {}),
    ...(datasource.caption ? { caption: datasource.caption } : {}),
  };
}

function commandPostconditionError(message: string): McpToolError {
  return new McpToolError({ type: 'command-postcondition', message, statusCode: 409 });
}
