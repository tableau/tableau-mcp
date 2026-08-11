import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { UnknownError } from '../../../errors/mcpToolError.js';
import { getFeatureGate } from '../../../features/init.js';
import { useRestApi } from '../../../restApiInstance.js';
import { Project } from '../../../sdks/tableau/types/project.js';
import { Workbook } from '../../../sdks/tableau/types/workbook.js';
import { ValidationIssue } from '../../../sdks/tableau/types/workbookValidation.js';
import { WebMcpServer } from '../../../server.web.js';
import { Provider } from '../../../utils/provider.js';
import { WebTool } from '../tool.js';
import { getDefaultViewWebUrl } from '../utils/viewUrlUtils.js';
import { resolveLocalWorkbook } from './localWorkbookFile.js';

const paramsSchema = {
  workbookFilePath: z
    .string()
    .min(1)
    .describe(
      'Absolute path to a local Tableau workbook (.twb) file accessible to the MCP server.',
    ),
  name: z.string().describe('The name to give the published workbook.'),
  overwrite: z
    .boolean()
    .optional()
    .describe(
      'Whether to overwrite an existing workbook with the same name in the target project. Defaults to false.',
    ),
};

export type ValidateUploadAndPublishWorkbookResult =
  | {
      status: 'published';
      data: Workbook;
      url: string;
      warnings: ValidationFinding[];
    }
  | {
      status: 'invalid';
      errors: ValidationFinding[];
      warnings: ValidationFinding[];
    };

type ValidationFinding = {
  severity: string;
  message: string;
  line: number;
  column: number;
  elementName: string;
};

export const getValidateUploadAndPublishWorkbookTool = (
  server: WebMcpServer,
): WebTool<typeof paramsSchema> => {
  const tool = new WebTool({
    server,
    name: 'validate-upload-and-publish-workbook',
    description:
      'Validates a local TWB workbook with Tableau, uploads it only when validation succeeds, and immediately publishes it to the site Default project. If validation returns blocking errors, the tool returns those findings and does not publish anything.',
    paramsSchema,
    annotations: {
      title: 'Validate, Upload, and Publish Workbook',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    disabled: new Provider(
      async () => !(await getFeatureGate().isFeatureEnabled('upload-validate-publish')),
    ),
    callback: async ({ workbookFilePath, name, overwrite }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute<ValidateUploadAndPublishWorkbookResult>({
        extra,
        args: { workbookFilePath: '<redacted>', name, overwrite },
        callback: async () => {
          const workbookFile = await resolveLocalWorkbook(workbookFilePath);

          const result = await useRestApi({
            ...extra,
            jwtScopes: tool.requiredApiScopes,
            callback: async (restApi) => {
              const validation = await restApi.workbooksMethods.validateWorkbookAndUpload({
                siteId: restApi.siteId,
                filename: workbookFile.fileName,
                workbook: workbookFile.bytes,
              });

              const errors = (validation.errors ?? []).map(toValidationFinding);
              const warnings = (validation.warnings ?? []).map(toValidationFinding);

              if (errors.length > 0) {
                return { status: 'invalid' as const, errors, warnings };
              }

              if (!validation.uploadId) {
                throw new UnknownError(
                  'Tableau validation succeeded but did not return an uploadId to publish.',
                );
              }

              const defaultProject = await getDefaultProject(restApi);
              const publishedWorkbook = await restApi.workbooksMethods.publishWorkbook({
                siteId: restApi.siteId,
                uploadSessionId: validation.uploadId,
                name,
                workbookType: 'twb',
                projectId: defaultProject.id,
                overwrite,
              });

              const url =
                getDefaultViewWebUrl(publishedWorkbook, extra.config.server, extra.getSiteName()) ??
                publishedWorkbook.webpageUrl ??
                '';

              return { status: 'published' as const, data: publishedWorkbook, url, warnings };
            },
          });

          return new Ok(result);
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
        getSuccessResult: (result) => ({
          isError: false,
          structuredContent: result,
          content: [{ type: 'text', text: JSON.stringify(result) }],
        }),
      });
    },
  });

  return tool;
};

async function getDefaultProject(restApi: {
  siteId: string;
  projectsMethods: {
    queryProjects: (args: {
      siteId: string;
      filter: string;
      pageSize?: number;
      pageNumber?: number;
    }) => Promise<{ projects: Project[] }>;
  };
}): Promise<Project> {
  const { projects } = await restApi.projectsMethods.queryProjects({
    siteId: restApi.siteId,
    filter: 'name:eq:Default',
    pageSize: 100,
    pageNumber: 1,
  });
  const defaultProject = projects.find(
    (project) => project.name === 'Default' && project.parentProjectId === undefined,
  );

  if (!defaultProject) {
    throw new UnknownError('Could not find the site Default project to publish the workbook.');
  }

  return defaultProject;
}

function toValidationFinding(issue: ValidationIssue): ValidationFinding {
  return {
    severity: sanitizeFindingText(issue.severity, 100),
    message: sanitizeFindingText(issue.message, 2_000),
    line: issue.line,
    column: issue.column,
    elementName: sanitizeFindingText(issue.elementName, 255),
  };
}

function sanitizeFindingText(value: string, maxLength: number): string {
  return Array.from(value)
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 32 || codePoint === 127 ? ' ' : character;
    })
    .join('')
    .slice(0, maxLength);
}
