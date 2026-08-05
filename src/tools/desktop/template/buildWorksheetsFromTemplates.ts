import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, type Stats } from 'fs';
import { resolve } from 'path';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import {
  bindExplicitTemplate,
  type ExplicitBindError,
} from '../../../desktop/binder/explicit-bind.js';
import type { TemplateManifest } from '../../../desktop/binder/manifest-types.js';
import { summarizeSchema } from '../../../desktop/binder/schema-summary.js';
import { getWorkbookXml } from '../../../desktop/commands/workbook/getWorkbookXml.js';
import { parseDatasourceQualifiedColumnRef } from '../../../desktop/metadata/field-resolver.js';
import { extractLastWorksheetArtifact } from '../../../desktop/metadata/sheets.js';
import {
  deriveWorksheetApplyState,
  type WorksheetApplyState,
} from '../../../desktop/metadata/targetWorksheetState.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import { buildInjectedWorkbookXml } from '../../../desktop/templates/injectTemplateCore.js';
import type { OptionalFieldPruneSpec } from '../../../desktop/templates/optionalFieldPrune.js';
import {
  getTemplateArtifactStore,
  templateArtifactSessionIdentity,
} from '../../../desktop/templates/templateArtifactStore.js';
import {
  listTemplateCatalog,
  MAX_EXTERNAL_TEMPLATE_BYTES,
} from '../../../desktop/templates/templatePath.js';
import { resolveTemplateSnapshot } from '../../../desktop/templates/templateSlots.js';
import { blockingValidationIssues, runValidation } from '../../../desktop/validation/registry.js';
import { ArgsValidationError, XmlValidationError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { jsonToolResult } from '../structuredContent.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  workbookFile: z.string().max(4096).optional().describe('Workbook file; omit for live Desktop.'),
  session: z.string().max(64).optional().describe('Live Desktop session.'),
  templateName: z.string().min(1).max(255).describe('Template catalog name.'),
  title: z.string().min(1).max(255).describe('Sheet title.'),
  datasource: z.string().min(1).max(255).describe('Mapped datasource.'),
  fieldMapping: z
    .record(z.string().max(128), z.string().max(512))
    .refine(
      (mapping) => Object.keys(mapping).length <= 32,
      'fieldMapping supports at most 32 slots.',
    )
    .describe('Slots.'),
};

const BUILD_RESPONSE_LIMIT_BYTES = 12_288;
export const MAX_OFFLINE_WORKBOOK_BYTES = 64 * 1024 * 1024;
const OFFLINE_WORKBOOK_READ_ERROR = `The saved workbook file could not be read safely. It must be a regular file no larger than ${MAX_OFFLINE_WORKBOOK_BYTES} bytes. No template artifact was created and the workbook was not changed. Correct the workbook path or file and build again if still wanted.`;
const OFFLINE_WORKBOOK_XML_ERROR =
  'The saved workbook could not be safely parsed or used to build a template artifact. No template artifact was created and the workbook was not changed. Correct the saved workbook and build again if still wanted.';
const LIVE_WORKSHEET_CONSTRUCTION_ERROR =
  'The template worksheet could not be safely constructed from the live workbook. No template artifact was created and the workbook was not changed. Correct the current inputs or choose another pass-1-eligible template.';

type OfflineWorkbookReadResult = { ok: true; text: string } | { ok: false };

function haveMatchingFileIdentity(opened: Stats, current: Stats): boolean {
  if (opened.ino === 0 || current.ino === 0) return process.platform === 'win32';
  return opened.dev === current.dev && opened.ino === current.ino;
}

function readOfflineWorkbookFile(path: string): OfflineWorkbookReadResult {
  let fd: number | null = null;
  try {
    const resolvedPath = resolve(path);
    const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
    fd = openSync(resolvedPath, constants.O_RDONLY | noFollow);
    const opened = fstatSync(fd);
    const current = lstatSync(resolvedPath);
    if (
      !opened.isFile() ||
      !current.isFile() ||
      current.isSymbolicLink() ||
      !haveMatchingFileIdentity(opened, current) ||
      opened.size > MAX_OFFLINE_WORKBOOK_BYTES ||
      current.size > MAX_OFFLINE_WORKBOOK_BYTES
    ) {
      return { ok: false };
    }

    // Match the repository-template reader's max+1 overflow check without allocating the full cap.
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    while (totalBytes <= MAX_OFFLINE_WORKBOOK_BYTES) {
      const buffer = Buffer.allocUnsafe(
        Math.min(64 * 1024, MAX_OFFLINE_WORKBOOK_BYTES + 1 - totalBytes),
      );
      const count = readSync(fd, buffer, 0, buffer.length, null);
      if (count === 0) break;
      totalBytes += count;
      chunks.push(buffer.subarray(0, count));
    }
    return totalBytes > MAX_OFFLINE_WORKBOOK_BYTES
      ? { ok: false }
      : { ok: true, text: Buffer.concat(chunks, totalBytes).toString('utf-8') };
  } catch {
    return { ok: false };
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // A failed close cannot make an untrusted offline workbook safe to consume.
      }
    }
  }
}

/** Metadata-optional constructor whose XML, eligibility, and slots share one source read. */
interface BuildSuccess {
  artifactId: string;
  artifactExpiresAt: string;
  templateName: string;
  templateProvenance: string;
  metadataTrust: 'trusted-protected-or-dev' | 'untrusted-repository';
  overridesLowerPrecedence: boolean;
  preview: {
    worksheetName: string;
    datasource: string;
    fieldMapping: Record<string, string>;
    targetState: WorksheetApplyState['target']['state'];
    targetWindowState: WorksheetApplyState['targetWindow']['state'];
    warningCount: number;
    artifactBytes: number;
  };
  guidance: string;
}

function formatArtifactBindErrors(templateName: string, errors: ExplicitBindError[]): string {
  const rendered = errors
    .map((error) => {
      const slot = error.slot_id ? ` (slot '${error.slot_id}')` : '';
      const candidates =
        error.candidates && error.candidates.length > 0
          ? `\n      candidates: ${error.candidates.join(', ')}`
          : '';
      return `  - [${error.code}]${slot} ${error.detail}${candidates}`;
    })
    .join('\n');
  const causes = rendered.length > 0 ? `\n\n${rendered}` : '';

  return (
    `Template artifact binding BLOCKED for '${templateName}'.${causes}\n\n` +
    'No template artifact was created. Choose another pass-1-eligible template from list-templates if still wanted.'
  );
}

function inferSingleDatasourceFromFieldMapping(
  fieldMapping: Record<string, string>,
): string | null {
  const datasources = new Set<string>();
  for (const ref of Object.values(fieldMapping)) {
    const datasource = parseDatasourceQualifiedColumnRef(ref.trim())?.datasource;
    if (datasource) datasources.add(datasource);
  }
  return datasources.size === 1 ? [...datasources][0] : null;
}

const toolTitle = 'Build Worksheets From Templates';
export const getBuildWorksheetsFromTemplatesTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const artifactStore = getTemplateArtifactStore(server);
  const tool = new DesktopTool({
    server,
    name: 'build-worksheets-from-templates',
    title: toolTitle,
    description: 'Build a guarded worksheet artifact.',
    paramsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    callback: async (
      { workbookFile, session, templateName, title, datasource, fieldMapping },
      extra,
    ): Promise<CallToolResult> => {
      return await tool.logAndExecute({
        extra,
        args: {
          workbookFile,
          session,
          templateName,
          title,
          datasource,
          fieldMapping,
        },
        callback: async () => {
          if (workbookFile !== undefined && session !== undefined) {
            return new ArgsValidationError(
              'workbookFile and session cannot both be provided. Use workbookFile for a saved snapshot, or omit it to read the live workbook.',
            ).toErr();
          }

          const environmentRepositoryRoot = process.env['TABLEAU_REPOSITORY_DIR'];
          let repositoryRoot = workbookFile === undefined ? undefined : environmentRepositoryRoot;
          let resolvedLiveSession: string | undefined;
          let liveExecutor: Awaited<ReturnType<typeof extra.getExecutor>> | undefined;
          let liveArtifactSessionIdentity: string | undefined;
          if (workbookFile === undefined) {
            const requestedSession = session?.trim();
            const explicitSession =
              requestedSession !== undefined &&
              requestedSession.length > 0 &&
              requestedSession.toLowerCase() !== 'default';
            const sessionResult = resolveSession(session);
            if (sessionResult.isErr()) return sessionResult.error.toErr();
            const resolvedSession = sessionResult.value;
            resolvedLiveSession = resolvedSession;
            liveExecutor = await extra.getExecutor(resolvedSession);
            liveArtifactSessionIdentity = templateArtifactSessionIdentity(
              resolvedSession,
              liveExecutor.desktopInstanceId,
            );
            artifactStore.invalidateAvailable(liveArtifactSessionIdentity);
            try {
              const appResult = await liveExecutor.getApp(extra.signal);
              if (appResult.isOk()) {
                const liveRoot = appResult.value.repositoryLocation?.trim();
                if (liveRoot) repositoryRoot = liveRoot;
              }
            } catch {
              // The environment fallback below is the only caller-neutral fallback.
            }
            if (!repositoryRoot && explicitSession && !process.env['TEMPLATES_DIR']) {
              return new ArgsValidationError(
                `Template repository discovery failed for explicit Desktop session "${requestedSession}". No worksheet was produced.`,
              ).toErr();
            }
            repositoryRoot ??= environmentRepositoryRoot;
            if (!repositoryRoot && !process.env['TEMPLATES_DIR']) {
              return new ArgsValidationError(
                'Template repository discovery unavailable: Desktop app info did not provide repositoryLocation and TABLEAU_REPOSITORY_DIR is not set. No worksheet was produced.',
              ).toErr();
            }
          }

          const templateSnapshot = resolveTemplateSnapshot(templateName, { repositoryRoot });
          if (templateSnapshot === null) {
            const catalog = listTemplateCatalog({ repositoryRoot });
            const rejected = catalog.find(
              (entry) => entry.template === templateName && entry.discoveryIssue !== undefined,
            );
            if (rejected?.discoveryIssue) {
              const issueDescription =
                rejected.discoveryIssue === 'file-too-large'
                  ? 'too large'
                  : 'invalid or unreadable';
              const limit =
                rejected.discoveryIssue === 'file-too-large'
                  ? ` (external template limit: ${MAX_EXTERNAL_TEMPLATE_BYTES} bytes)`
                  : '';
              return new ArgsValidationError(
                `Template "${templateName}" from ${rejected.provenance} is ${issueDescription}${limit}. No worksheet was produced, and the lower-precedence template was not used.`,
              ).toErr();
            }
            return new ArgsValidationError(
              `Template "${templateName}" not found. Use list-templates to choose a current catalog entry.`,
            ).toErr();
          }
          const {
            artifact: templateArtifact,
            resolvedManifest,
            provenance: templateProvenance,
            overridesLowerPrecedence,
          } = templateSnapshot;
          if (!templateArtifact.eligibility.pass1_eligible) {
            return new ArgsValidationError(
              `Template "${templateName}" from ${templateProvenance} is not supported for artifact construction. No worksheet was produced; choose another template from list-templates.`,
            ).toErr();
          }

          let workbookXml: string;
          if (workbookFile !== undefined) {
            const readResult = readOfflineWorkbookFile(workbookFile);
            if (!readResult.ok) return new ArgsValidationError(OFFLINE_WORKBOOK_READ_ERROR).toErr();
            workbookXml = readResult.text;
          } else {
            const workbookResult = await getWorkbookXml({
              executor: liveExecutor!,
              signal: extra.signal,
            });
            if (workbookResult.isErr()) {
              return new ArgsValidationError(
                'The live workbook could not be read. No template artifact was created and the workbook was not changed. Read the current workbook and build again if still wanted.',
              ).toErr();
            }
            workbookXml = workbookResult.value;
          }

          try {
            // Metadata-optional binding: the binder is handed the FULL resolved catalog so a
            // `.tbm`-only template (no curated manifest) still binds against its inferred slots.
            const manifests = new Map<string, TemplateManifest>();
            if (resolvedManifest) manifests.set(templateName, resolvedManifest.manifest);
            let appliedFieldMapping = fieldMapping;
            let optionalFieldPrunes: OptionalFieldPruneSpec[] = [];
            const warnings: string[] = [];
            if (fieldMapping && Object.keys(fieldMapping).length > 0) {
              const explicitBind = bindExplicitTemplate(
                templateName,
                fieldMapping,
                summarizeSchema(workbookXml),
                { title, datasource, manifests },
              );

              if (!explicitBind.ok) {
                if (workbookFile !== undefined) {
                  return new ArgsValidationError(OFFLINE_WORKBOOK_XML_ERROR).toErr();
                }
                return new ArgsValidationError(
                  formatArtifactBindErrors(templateName, explicitBind.errors),
                ).toErr();
              }

              const resolvedDatasource = explicitBind.passthrough
                ? (inferSingleDatasourceFromFieldMapping(fieldMapping) ?? explicitBind.datasource)
                : explicitBind.datasource;

              if (resolvedDatasource !== datasource) {
                if (workbookFile !== undefined) {
                  return new ArgsValidationError(OFFLINE_WORKBOOK_XML_ERROR).toErr();
                }
                return new ArgsValidationError(
                  `Template binding BLOCKED for "${templateName}". No worksheet was produced.\n\n` +
                    `  • [datasource-mismatch] caller datasource "${datasource}" does not match resolved mapping datasource "${resolvedDatasource}".\n` +
                    `    No template artifact was created. Use datasource "${resolvedDatasource}" consistently, or choose fields from datasource "${datasource}" before building again.`,
                ).toErr();
              }

              if (!explicitBind.passthrough) appliedFieldMapping = explicitBind.fieldMapping;
              optionalFieldPrunes = explicitBind.optionalFieldPrunes;
              warnings.push(...explicitBind.warnings);
            }

            let worksheetXml: string;
            let worksheetWindowXml: string;
            let expectedState: WorksheetApplyState;
            let worksheetValidationWarningCount = 0;
            try {
              const applyNonce = `${workbookFile ?? session ?? 'live'}:${Date.now()}:${randomUUID()}`;
              const built = buildInjectedWorkbookXml({
                workbookXml,
                templateXml: templateArtifact.xml,
                title,
                sheetType: 'worksheet',
                templateParameters: { DATASOURCE: datasource },
                fieldMapping: appliedFieldMapping,
                // Metadata-optional slots: the merged manifest (inferred + any curated overlay).
                templateSlots: resolvedManifest?.manifest.slots,
                insertPosition: 'end',
                applyNonce,
                optionalFieldPrunes,
              });

              if (!built.ok) {
                if (workbookFile !== undefined) {
                  return new ArgsValidationError(OFFLINE_WORKBOOK_XML_ERROR).toErr();
                }
                return new ArgsValidationError(
                  `Template "${templateName}" from ${templateProvenance} could not be safely constructed. No worksheet was produced; choose another template or repair the source outside MCP.`,
                ).toErr();
              }

              const artifact = extractLastWorksheetArtifact(built.xml, title);
              if (!artifact) {
                if (workbookFile !== undefined) {
                  return new ArgsValidationError(OFFLINE_WORKBOOK_XML_ERROR).toErr();
                }
                return new XmlValidationError([
                  `Built workbook did not contain a worksheet and worksheet window named "${title}".`,
                ]).toErr();
              }
              ({ worksheetXml, worksheetWindowXml } = artifact);
              const worksheetValidationIssues = runValidation(worksheetXml, 'worksheet').issues;
              const blockingIssues = blockingValidationIssues(worksheetValidationIssues);
              if (blockingIssues.length > 0) {
                if (workbookFile !== undefined) {
                  return new ArgsValidationError(OFFLINE_WORKBOOK_XML_ERROR).toErr();
                }
                const ruleIds = [
                  ...new Set(
                    blockingIssues
                      .map((issue) => issue.ruleId.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 80))
                      .filter(Boolean),
                  ),
                ].slice(0, 5);
                const findings = ruleIds.length > 0 ? ` (${ruleIds.join(', ')})` : '';
                return new ArgsValidationError(
                  `Template construction blocked by worksheet validation${findings}. No template artifact was created and the workbook was not changed. Do not rebuild the same template with the same field mapping; choose a different pass-1-eligible template.`,
                ).toErr();
              }
              worksheetValidationWarningCount = worksheetValidationIssues.filter(
                (issue) => issue.severity === 'warning',
              ).length;
              expectedState = deriveWorksheetApplyState(
                workbookXml,
                title,
                worksheetXml,
                worksheetWindowXml,
              );
            } catch {
              return new ArgsValidationError(
                workbookFile === undefined
                  ? LIVE_WORKSHEET_CONSTRUCTION_ERROR
                  : OFFLINE_WORKBOOK_XML_ERROR,
              ).toErr();
            }
            if (
              expectedState.target.state === 'present' ||
              expectedState.targetWindow.state === 'present'
            ) {
              return new ArgsValidationError(
                'Template construction blocked because the requested title already names an existing worksheet or window. This template path creates new worksheets only. No template artifact was created; choose a fresh unique worksheet title before constructing another.',
              ).toErr();
            }
            const metadataTrust: BuildSuccess['metadataTrust'] =
              templateProvenance === 'protected' || templateProvenance === 'dev-override'
                ? 'trusted-protected-or-dev'
                : 'untrusted-repository';
            const preview: BuildSuccess['preview'] = {
              worksheetName: title,
              datasource,
              fieldMapping: appliedFieldMapping,
              targetState: expectedState.target.state,
              targetWindowState: expectedState.targetWindow.state,
              warningCount: warnings.length + worksheetValidationWarningCount,
              artifactBytes:
                Buffer.byteLength(worksheetXml) + Buffer.byteLength(worksheetWindowXml),
            };
            const baseResponse = {
              templateName,
              templateProvenance,
              metadataTrust,
              overridesLowerPrecedence,
              preview,
              guidance:
                'The workbook was not modified. This bounded artifact plan is not a visible preview. It is one-shot and expires. Immediately before dispatch, apply-worksheet checks the source workbook byte-for-byte. The External Client API cannot condition its final POST on a workbook revision, so an edit that races that write remains possible; if the apply outcome is uncertain, stop and inspect Tableau. Call apply-worksheet with this artifactId; if the pre-dispatch check finds a change, build a new artifact from the current workbook.' +
                (resolvedLiveSession === undefined
                  ? ''
                  : ' Another template build in this Desktop session invalidates this artifact. Do not batch or parallelize build-worksheets-from-templates; apply this artifact before building the next worksheet.') +
                ' Do not request or reconstruct raw worksheet XML, and never replay an uncertain apply.',
            };
            const projectedResponse: BuildSuccess = {
              artifactId: '00000000-0000-4000-8000-000000000000',
              artifactExpiresAt: new Date(0).toISOString(),
              ...baseResponse,
            };
            if (
              Buffer.byteLength(JSON.stringify(jsonToolResult(projectedResponse)), 'utf8') >
              BUILD_RESPONSE_LIMIT_BYTES
            ) {
              return new ArgsValidationError(
                'The validated artifact plan exceeds the response limit. No template artifact was created and the workbook was not changed. Reduce the mapped inputs and build again if still wanted.',
              ).toErr();
            }

            const artifactSessionIdentity =
              resolvedLiveSession === undefined
                ? null
                : templateArtifactSessionIdentity(
                    resolvedLiveSession,
                    liveExecutor?.desktopInstanceId,
                  );
            if (
              artifactSessionIdentity !== null &&
              artifactSessionIdentity !== liveArtifactSessionIdentity
            ) {
              artifactStore.invalidateAvailable(artifactSessionIdentity);
            }
            const { artifactId, expiresAt } = artifactStore.put(artifactSessionIdentity, {
              worksheetName: title,
              worksheetXml,
              worksheetWindowXml,
              expectedState,
              templateProvenance,
              metadataTrust,
            });
            return new Ok<BuildSuccess>({
              artifactId,
              artifactExpiresAt: new Date(expiresAt).toISOString(),
              ...baseResponse,
            });
          } catch (error) {
            if (workbookFile !== undefined) {
              return new ArgsValidationError(OFFLINE_WORKBOOK_XML_ERROR).toErr();
            }
            throw error;
          }
        },
        getSuccessResult: (value) => jsonToolResult(value),
      });
    },
  });
  return tool;
};
