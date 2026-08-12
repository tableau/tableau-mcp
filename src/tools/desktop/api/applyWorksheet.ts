import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'crypto';
import { Ok, type Result } from 'ts-results-es';
import { z } from 'zod';

import { emitWorksheetPromiseEvents } from '../../../desktop/episode-events.js';
import { resolveSession } from '../../../desktop/session/sessionResolution.js';
import {
  buildTemplateWorksheetArtifact,
  type BuiltTemplateWorksheetArtifact,
  type WorksheetTemplatePlan,
} from '../../../desktop/templates/buildTemplateWorksheetArtifact.js';
import {
  getTemplateArtifactStore,
  type TemplateArtifactStore,
} from '../../../desktop/templates/templateArtifactStore.js';
import {
  classifyWorksheetPromiseOutcome,
  formatWorksheetPromiseCheck,
} from '../../../desktop/validation/promise-check.js';
import { formatReadbackVerificationWarnings } from '../../../desktop/validation/readback-verify.js';
import { loadWorksheetXml } from '../../../desktop/wrappers/loadWorksheetXml.js';
import {
  ArgsValidationError,
  DesktopCommandExecutionError,
  McpToolError,
  WorksheetXmlLoadFailedError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { clearStickyWorksheetFile } from '../authoring/fields/worksheetEditBuffer.js';
import { artifactFileParam, artifactNameParam, sessionParam } from '../params.js';
import {
  doneNextAction,
  jsonToolResult,
  prefillNextAction,
  receipt,
  StructuredResult,
  withNextAction,
} from '../structuredContent.js';
import { DesktopTool } from '../tool.js';
import { runApplyPreamble } from './applyPreamble.js';
import {
  applyWorksheetArtifact,
  applyWorksheetArtifactPayload,
  templateArtifactUnavailableError,
} from './applyWorksheetArtifact.js';

const templatePlanSchema = z.object({
  templateName: z.string().trim().min(1).max(128).describe('Worksheet template ID.'),
  title: z.string().trim().min(1).max(255).describe('Worksheet name to create.'),
  datasource: z.string().trim().min(1).max(255).describe('Live datasource name.'),
  fieldMapping: z
    .record(z.string().trim().min(1).max(128), z.string().trim().min(1).max(255))
    .describe('Template slot ID to live field reference.'),
});

const paramsSchema = {
  session: sessionParam({ max: 64 }),
  artifactId: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .optional()
    .describe('Template artifact ID; omit for a direct template plan or cached-file apply.'),
  templatePlan: templatePlanSchema
    .optional()
    .describe('Exact template binding to build and apply in this call.'),
  worksheetName: artifactNameParam('worksheet', { min: 1, max: 255 })
    .optional()
    .describe('Existing worksheet name for cached-file apply; omit with other modes.'),
  worksheetFile: artifactFileParam('worksheet', { max: 4096 })
    .optional()
    .describe('Cached worksheet path for manual apply; omit with other modes.'),
};

const title = 'Updating worksheet';

type ApplyWorksheetResult =
  | { message: string }
  | {
      artifactId?: string;
      title: string;
      applied: true;
      retrySafe: false;
      verification: {
        ok: boolean;
        status: 'passed' | 'warning' | 'failed' | 'skipped';
        message?: string;
      };
    };

export const getApplyWorksheetTool = (
  server: DesktopMcpServer,
  dependencies: {
    store?: TemplateArtifactStore;
    createId?: () => string;
    buildArtifact?: typeof buildTemplateWorksheetArtifact;
  } = {},
): DesktopTool<typeof paramsSchema> => {
  const artifactStore = dependencies.store ?? getTemplateArtifactStore(server);
  const createId = dependencies.createId ?? randomUUID;
  const buildArtifact = dependencies.buildArtifact ?? buildTemplateWorksheetArtifact;
  const applyWorksheetTool = new DesktopTool({
    server,
    name: 'apply-worksheet',
    title,
    description:
      'Build and apply an exact template plan, apply a template artifact, or update a cached worksheet file.',
    paramsSchema,
    annotations: {
      readOnlyHint: false, // updates worksheet in workbook
      openWorldHint: false,
      destructiveHint: true, // updates active workbook
      idempotentHint: false,
    },
    callback: async (
      { session, artifactId, templatePlan, worksheetName, worksheetFile },
      extra,
    ): Promise<CallToolResult> => {
      return await applyWorksheetTool.logAndExecute({
        extra,
        args: { session, artifactId, templatePlan, worksheetName, worksheetFile },
        callback: async (): Promise<
          Result<StructuredResult<ApplyWorksheetResult>, McpToolError>
        > => {
          const cachedModeSelected = worksheetName !== undefined || worksheetFile !== undefined;
          const modeCount =
            Number(artifactId !== undefined) +
            Number(templatePlan !== undefined) +
            Number(cachedModeSelected);
          if (modeCount !== 1) {
            return new ArgsValidationError(
              'Provide exactly one apply mode: artifactId, templatePlan, or worksheetName with worksheetFile.',
            ).toErr();
          }
          if (cachedModeSelected && !worksheetName?.trim()) {
            return new ArgsValidationError(
              'A worksheetName is required when applying a cached worksheet file.',
            ).toErr();
          }

          if (artifactId !== undefined) {
            const sessionResult = resolveSession(session);
            if (sessionResult.isErr()) return sessionResult.error.toErr();
            const resolvedSession = sessionResult.value;
            const reservation = artifactStore.reserve(artifactId, resolvedSession);
            if (!reservation.ok) {
              return templateArtifactUnavailableError(artifactId, reservation.reason).toErr();
            }
            try {
              const executor = await extra.getExecutor(resolvedSession);
              const outcome = await applyWorksheetArtifact({
                store: artifactStore,
                artifactId,
                sessionId: resolvedSession,
                executor,
                signal: extra.signal,
                reservation,
              });
              if (outcome.state !== 'applied') return outcome.error.toErr();

              // A prior add-field/remove-field edit buffer for this sheet+session predates
              // this apply; whatever it was tracking is now stale, so close it rather than
              // let a later name-only call silently resume editing on top of it.
              clearStickyWorksheetFile({
                session: resolvedSession,
                worksheetName: outcome.receipt.title,
              });

              // The artifact apply already carries the verification outcome
              // (applyWorksheetArtifact resolves the skipped fallback), so the
              // structured receipt references that same object rather than
              // deriving a second account of the readback.
              const verification = outcome.receipt.verification;
              const verificationRan = verification.status !== 'skipped';
              return Ok(
                withNextAction(
                  {
                    artifactId: outcome.receipt.artifactId,
                    title: outcome.receipt.title,
                    applied: true as const,
                    retrySafe: false as const,
                    verification,
                  },
                  // A 'done' marker tells the agent to stop; an observed FAILED readback
                  // is the one outcome where stopping buries the failure, so that branch
                  // points at the follow-up work instead of minting a terminal receipt.
                  verification.status === 'failed'
                    ? prefillNextAction('Verification failed — inspect sheet, rebuild artifact')
                    : doneNextAction(
                        receipt({
                          did: [
                            `Desktop accepted the artifact apply for worksheet "${outcome.receipt.title}"`,
                            ...(verificationRan
                              ? [
                                  `read back the applied worksheet — verification status "${verification.status}"`,
                                ]
                              : []),
                          ],
                          unverified: verificationRan
                            ? [
                                'whether the sheet renders as intended — readback compared workbook XML, not rendered output',
                              ]
                            : [
                                'whether the applied worksheet retained its intended structure — post-apply workbook readback was unavailable',
                              ],
                        }),
                        'Artifact apply dispatched — see verification',
                      ),
                ),
              );
            } catch (error) {
              artifactStore.release(reservation.lease);
              throw error;
            }
          }

          if (templatePlan !== undefined) {
            const sessionResult = resolveSession(session);
            if (sessionResult.isErr()) return sessionResult.error.toErr();
            const resolvedSession = sessionResult.value;
            const executor = await extra.getExecutor(resolvedSession);
            const workbookResult = await executor.getWorkbookDocument(extra.signal);
            if (workbookResult.isErr()) {
              return new DesktopCommandExecutionError(workbookResult.error).toErr();
            }
            const instanceId = workbookResult.value.instanceId;
            if (!instanceId) {
              return new DesktopCommandExecutionError({
                type: 'invalid-response',
                error: new Error(
                  'Workbook read did not identify its External Client API instance.',
                ),
              }).toErr();
            }

            const built: Result<BuiltTemplateWorksheetArtifact, McpToolError> = buildArtifact({
              artifactId: createId(),
              sessionId: resolvedSession,
              instanceId,
              workbookXml: workbookResult.value.xml,
              plan: templatePlan as WorksheetTemplatePlan,
            });
            if (built.isErr()) return built.error.toErr();

            const outcome = await applyWorksheetArtifactPayload({
              artifact: built.value.artifact,
              executor,
              signal: extra.signal,
            });
            if (outcome.state !== 'applied') return outcome.error.toErr();

            clearStickyWorksheetFile({
              session: resolvedSession,
              worksheetName: outcome.receipt.title,
            });

            const verification = outcome.receipt.verification;
            const verificationRan = verification.status !== 'skipped';
            return Ok(
              withNextAction(
                {
                  title: outcome.receipt.title,
                  applied: true as const,
                  retrySafe: false as const,
                  verification,
                },
                verification.status === 'failed'
                  ? prefillNextAction('Verification failed — inspect sheet, build again')
                  : doneNextAction(
                      receipt({
                        did: [
                          `Desktop accepted the direct template apply for worksheet "${outcome.receipt.title}"`,
                          ...(verificationRan
                            ? [
                                `read back the applied worksheet — verification status "${verification.status}"`,
                              ]
                            : []),
                        ],
                        unverified: verificationRan
                          ? [
                              'whether the sheet renders as intended — readback compared workbook structure, not rendered output',
                            ]
                          : [
                              'whether the applied worksheet retained its intended structure — post-apply workbook readback was unavailable',
                            ],
                      }),
                      'Direct template apply dispatched — see verification',
                    ),
              ),
            );
          }

          const preamble = runApplyPreamble({
            kind: 'worksheet',
            file: worksheetFile,
            session,
            emptyPathGuidance:
              'Get one from get-worksheet-xml, edit it with read-cached-xml and ' +
              'write-cached-xml, then pass that path here.',
            notFoundGuidance: 'Provide a path returned by get-worksheet-xml.',
          });
          if (preamble.isErr()) {
            return preamble;
          }
          const { xml: worksheetXml, resolvedSession } = preamble.value;

          const executor = await extra.getExecutor(resolvedSession);
          const result = await loadWorksheetXml({
            worksheetName: worksheetName!,
            xml: worksheetXml,
            focus: { navigate: 'artifact', sheetName: worksheetName! },
            executor,
            signal: extra.signal,
            // apply-worksheet updates an existing worksheet in place via the per-sheet `/document`
            // route; a name that does not resolve surfaces as an error rather than creating a sheet
            // through the whole-workbook path (build-worksheets-from-templates owns net-new creation).
            requireExistingSheet: true,
          });

          if (result.isErr()) {
            const { type, error } = result.error;
            switch (type) {
              case 'execute-command-error':
                return new DesktopCommandExecutionError(error).toErr();
              case 'load-worksheet-xml-error':
                return new WorksheetXmlLoadFailedError(error).toErr();
              default: {
                const _: never = type;
              }
            }
          }

          // Non-fatal post-apply readback warnings (e.g. a sort Tableau reshaped) ride
          // along so the agent can re-check the rendered chart before moving on (W4).
          const readbackWarning = result.isOk()
            ? formatReadbackVerificationWarnings(result.value.readbackWarnings)
            : '';
          // Host verification receipt (W-23447506) — subsumes the old readback
          // status sentence: one host-truth line, derived from preflight +
          // readback, never model-filled.
          const receiptInput = result.isOk()
            ? {
                validationWarnings: result.value.validationWarnings ?? [],
                readback: result.value.readbackVerification,
                readbackFindings: result.value.readbackWarnings,
              }
            : undefined;
          const promiseOutcome = receiptInput
            ? classifyWorksheetPromiseOutcome(receiptInput)
            : 'unverified';
          if (result.isOk()) {
            await emitWorksheetPromiseEvents({
              config: extra.config,
              sessionId: resolvedSession,
              tool: 'apply-worksheet',
              operation: 'load-worksheet',
              readback: result.value.readbackVerification,
              findings: result.value.readbackWarnings,
              promiseOutcome,
            });
          }
          const hostVerification = receiptInput ? formatWorksheetPromiseCheck(receiptInput) : '';

          // The edits just landed — close the buffer so a later name-only add-field/
          // remove-field call starts from a fresh live read instead of resuming this file.
          clearStickyWorksheetFile({ session: resolvedSession, worksheetName: worksheetName! });

          // The structured receipt is derived from the same readback outcome the text
          // reports: when the readback ran its status is an observation; when it was
          // skipped or absent, the applied structure is listed as unverified.
          const readback = receiptInput?.readback;
          const readbackRan = readback !== undefined && readback.status !== 'skipped';
          return new Ok(
            withNextAction(
              {
                message: `Successfully applied worksheet update for "${worksheetName}". The worksheet has been updated.${readbackWarning}${hostVerification}`,
              },
              doneNextAction(
                receipt({
                  did: [
                    `Desktop accepted the worksheet XML apply for "${worksheetName}"`,
                    `preflight validation returned ${receiptInput?.validationWarnings.length ?? 0} warning(s)`,
                    ...(readbackRan
                      ? [
                          `read back the applied worksheet — verification status "${readback.status}", promise outcome "${promiseOutcome}"`,
                        ]
                      : []),
                  ],
                  unverified: readbackRan
                    ? [
                        'whether the sheet renders as intended — readback compared workbook XML, not rendered output',
                      ]
                    : [
                        'whether the applied worksheet retained its intended structure — post-apply readback was unavailable',
                      ],
                }),
                'Worksheet apply finished — see verification',
              ),
            ),
          );
        },
        getSuccessResult: (result) => jsonToolResult(result, { isError: false }),
      });
    },
  });

  return applyWorksheetTool;
};
