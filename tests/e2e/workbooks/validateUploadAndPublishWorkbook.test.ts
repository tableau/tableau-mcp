import { readFile } from 'fs/promises';
import { basename, resolve } from 'path';
import { z } from 'zod';

import { workbookSchema } from '../../../src/sdks/tableau/types/workbook.js';
import { getDefaultEnv, resetEnv, setEnv } from '../../testEnv.js';
import { buildVariant } from '../build.js';
import { McpClient } from '../mcpClient.js';

const validationFindingSchema = z.object({
  severity: z.string(),
  message: z.string(),
  line: z.number(),
  column: z.number(),
  elementName: z.string(),
});

const validateUploadAndPublishWorkbookResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('published'),
    data: workbookSchema,
    url: z.string(),
    warnings: z.array(validationFindingSchema),
  }),
  z.object({
    status: z.literal('invalid'),
    errors: z.array(validationFindingSchema),
    warnings: z.array(validationFindingSchema),
  }),
]);

const requestWorkbookUploadResultSchema = z.object({
  workbookUploadId: z.string(),
  uploadUrl: z.string(),
  expiresAt: z.string(),
  maxSizeBytes: z.number(),
  requiredHeaders: z.record(z.string(), z.string()),
});

const defaultWorkbookFilePath = resolve('tests/e2e/fixtures/workbooks/superstore-datasource.twb');

type ValidateUploadPublishSmokeConfig = {
  workbookFilePath: string;
  workbookName: string;
  projectId: string;
};

describe('validate-upload-and-publish-workbook staged upload', () => {
  let client: McpClient | undefined;

  beforeAll(() => {
    if (isValidateUploadPublishSmokeRequested()) {
      setEnv();
    }
  });

  afterAll(() => {
    if (isValidateUploadPublishSmokeRequested()) {
      resetEnv();
    }
  });

  beforeAll(async () => {
    const smokeConfig = getValidateUploadPublishSmokeConfig();
    if (!smokeConfig) {
      return;
    }

    await buildVariant('default');
    client = new McpClient({ env: getValidateUploadPublishSmokeEnv() });
    await client.connect();
  });

  afterAll(async () => {
    await client?.close();
  });

  it('validates and publishes a staged workbook upload', async () => {
    const smokeConfig = getValidateUploadPublishSmokeConfig();
    if (!smokeConfig || !client) {
      console.warn(
        'Skipping validate-upload-and-publish-workbook e2e. Set VALIDATE_UPLOAD_PUBLISH_E2E=true to run it.',
      );
      return;
    }

    const workbookBytes = await readFile(smokeConfig.workbookFilePath);
    const uploadResult = await client.callTool('request-workbook-upload', {
      schema: requestWorkbookUploadResultSchema,
      toolArgs: {
        fileName: basename(smokeConfig.workbookFilePath),
      },
    });

    const uploadResponse = await fetch(uploadResult.uploadUrl, {
      method: 'PUT',
      headers: uploadResult.requiredHeaders,
      body: workbookBytes,
    });
    expect(uploadResponse.ok).toBe(true);

    const publishResult = await client.callTool('validate-upload-and-publish-workbook', {
      schema: validateUploadAndPublishWorkbookResultSchema,
      toolArgs: {
        workbookUploadId: uploadResult.workbookUploadId,
        name: smokeConfig.workbookName,
        projectId: smokeConfig.projectId,
        overwrite: true,
      },
    });

    expect(publishResult.status).toBe('published');
    if (publishResult.status === 'published') {
      expect(publishResult.data.name).toBe(smokeConfig.workbookName);
      expect(publishResult.url).toEqual(expect.any(String));
    }
  });
});

function getValidateUploadPublishSmokeConfig(): ValidateUploadPublishSmokeConfig | undefined {
  if (!isValidateUploadPublishSmokeRequested()) {
    return undefined;
  }
  const projectId = process.env.VALIDATE_UPLOAD_PUBLISH_E2E_PROJECT_ID?.trim();
  if (!projectId) {
    console.warn(
      'Skipping validate-upload-and-publish-workbook e2e. Set VALIDATE_UPLOAD_PUBLISH_E2E_PROJECT_ID to the destination project LUID.',
    );
    return undefined;
  }

  return {
    workbookFilePath:
      process.env.VALIDATE_UPLOAD_PUBLISH_E2E_FILE?.trim() || defaultWorkbookFilePath,
    workbookName:
      process.env.VALIDATE_UPLOAD_PUBLISH_E2E_NAME?.trim() || 'Codex Validate Publish E2E',
    projectId,
  };
}

function isValidateUploadPublishSmokeRequested(): boolean {
  return process.env.VALIDATE_UPLOAD_PUBLISH_E2E === 'true';
}

function getValidateUploadPublishSmokeEnv(): Record<string, string> {
  return {
    ...getDefaultEnv(),
    FEATURE_GATE_PROVIDER: 'custom',
    FEATURE_GATE_PROVIDER_CONFIG: JSON.stringify({
      module: './tests/e2e/fixtures/authoringToolsFeatureGate.cjs',
    }),
  };
}
