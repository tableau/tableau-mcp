import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'crypto';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { resolveSession } from '../../../../desktop/session/sessionResolution.js';
import {
  buildTemplateWorksheetArtifact,
  type WorksheetTemplatePlan,
} from '../../../../desktop/templates/buildTemplateWorksheetArtifact.js';
import {
  getTemplateArtifactStore,
  type TemplateArtifactStore,
} from '../../../../desktop/templates/templateArtifactStore.js';
import {
  ArgsValidationError,
  DesktopCommandExecutionError,
} from '../../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import { jsonToolResult } from '../../structuredContent.js';
import { DesktopTool } from '../../tool.js';

const paramsSchema = {
  session: z.string().optional().describe('Desktop process ID; omit for the current instance.'),
  templateName: z.string().trim().min(1).max(128).describe('Worksheet template ID.'),
  title: z.string().trim().min(1).max(255).describe('Worksheet name to build.'),
  datasource: z.string().trim().min(1).max(255).describe('Live datasource name.'),
  fieldMapping: z
    .record(z.string().trim().min(1).max(128), z.string().trim().min(1).max(255))
    .describe('Map slot ID to exact returned column_ref.'),
  topN: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe(
      'Limit a simple ranked worksheet to its first N members before storing the artifact.',
    ),
};

interface BuildWorksheetsFromTemplatesDependencies {
  store: TemplateArtifactStore;
  createId(): string;
}

export const getBuildWorksheetsFromTemplatesTool = (
  server: DesktopMcpServer,
  dependencies: Partial<BuildWorksheetsFromTemplatesDependencies> = {},
): DesktopTool<typeof paramsSchema> => {
  const store = dependencies.store ?? getTemplateArtifactStore(server);
  const createId = dependencies.createId ?? randomUUID;
  const tool = new DesktopTool({
    server,
    name: 'build-worksheets-from-templates',
    title: 'Building template worksheet',
    description: 'Build one worksheet artifact without changing Desktop.',
    paramsSchema,
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    callback: async (
      { session, templateName, title, datasource, fieldMapping, topN },
      extra,
    ): Promise<CallToolResult> => {
      return await tool.logAndExecute({
        extra,
        args: { session, templateName, title, datasource, fieldMapping, topN },
        getSuccessResult: (payload) => jsonToolResult(payload, { isError: false }),
        callback: async () => {
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) return sessionResult.error.toErr();
          const resolvedSession = sessionResult.value;
          const executor = await extra.getExecutor(resolvedSession);
          const workbookResult = await executor.getWorkbookDocument(extra.signal);
          if (workbookResult.isErr()) {
            return new DesktopCommandExecutionError(workbookResult.error).toErr();
          }
          const workbookXml = workbookResult.value.xml;
          const instanceId = workbookResult.value.instanceId;
          if (!instanceId) {
            return new DesktopCommandExecutionError({
              type: 'invalid-response',
              error: new Error('Workbook read did not identify its External Client API instance.'),
            }).toErr();
          }

          const artifactId = createId();
          const plan: WorksheetTemplatePlan = {
            templateName,
            title,
            datasource,
            fieldMapping,
            topN,
          };
          const built = buildTemplateWorksheetArtifact({
            artifactId,
            sessionId: resolvedSession,
            instanceId,
            workbookXml,
            plan,
          });
          if (built.isErr()) return built.error.toErr();

          const stored = store.put(built.value.artifact);
          if (!stored.ok) {
            return new ArgsValidationError(
              'Template artifact capacity is busy. Apply or release an in-use artifact, then retry.',
            ).toErr();
          }

          return Ok({
            artifactId,
            templateName,
            title,
            datasource: built.value.artifact.datasource,
            provenance: built.value.provenance,
            bindings: built.value.bindings,
            ...(topN !== undefined ? { topN } : {}),
          });
        },
      });
    },
  });
  return tool;
};
