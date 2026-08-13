import { readFile } from 'fs/promises';
import { basename } from 'path';
import { z } from 'zod';

import { workbookSchema } from '../../../src/sdks/tableau/types/workbook.js';
import { getDefaultEnv, resetEnv, setEnv } from '../../testEnv.js';
import { buildVariant } from '../build.js';
import { McpClient } from '../mcpClient.js';

const requestWorkbookUploadResultSchema = z.object({
  workbookUploadId: z.string().uuid(),
  uploadUrl: z.string().url(),
  expiresAt: z.string(),
  maxSizeBytes: z.number().int().positive(),
  requiredHeaders: z.record(z.string()),
});

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

type StagedUploadSmokeConfig = {
  workbookFilePath: string;
  workbookName: string;
  s3Bucket: string;
};

describe('validate-upload-and-publish-workbook staged upload', () => {
  let client: McpClient | undefined;

  beforeAll(() => {
    if (isStagedUploadSmokeRequested()) {
      setEnv();
    }
  });

  afterAll(() => {
    if (isStagedUploadSmokeRequested()) {
      resetEnv();
    }
  });

  beforeAll(async () => {
    const smokeConfig = getStagedUploadSmokeConfig();
    if (!smokeConfig) {
      return;
    }

    await buildVariant('default');
    client = new McpClient({ env: getStagedUploadSmokeEnv(smokeConfig) });
    await client.connect();
  });

  afterAll(async () => {
    await client?.close();
  });

  it('uploads workbook bytes to S3, resolves them by upload id, and publishes after validation', async () => {
    const smokeConfig = getStagedUploadSmokeConfig();
    if (!smokeConfig || !client) {
      console.warn(
        'Skipping staged workbook upload e2e. Set STAGED_WORKBOOK_UPLOAD_E2E=true, STAGED_WORKBOOK_UPLOAD_E2E_FILE, and MCP_S3_BUCKET to run it.',
      );
      return;
    }

    const workbookBytes = await readFile(smokeConfig.workbookFilePath);
    const fileName = basename(smokeConfig.workbookFilePath);
    const uploadRequest = await client.callTool('request-workbook-upload', {
      schema: requestWorkbookUploadResultSchema,
      toolArgs: {
        fileName,
        contentType: 'application/xml',
        sizeBytes: workbookBytes.byteLength,
      },
    });

    expect(workbookBytes.byteLength).toBeLessThanOrEqual(uploadRequest.maxSizeBytes);

    const uploadResponse = await fetch(uploadRequest.uploadUrl, {
      method: 'PUT',
      headers: uploadRequest.requiredHeaders,
      body: new Uint8Array(workbookBytes),
    });
    expect(uploadResponse.ok).toBe(true);

    const publishResult = await client.callTool('validate-upload-and-publish-workbook', {
      schema: validateUploadAndPublishWorkbookResultSchema,
      toolArgs: {
        workbookUploadId: uploadRequest.workbookUploadId,
        name: smokeConfig.workbookName,
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

function getStagedUploadSmokeConfig(): StagedUploadSmokeConfig | undefined {
  if (!isStagedUploadSmokeRequested()) {
    return undefined;
  }

  const workbookFilePath = process.env.STAGED_WORKBOOK_UPLOAD_E2E_FILE?.trim();
  const s3Bucket = process.env.MCP_S3_BUCKET?.trim();
  if (!workbookFilePath || !s3Bucket) {
    return undefined;
  }

  return {
    workbookFilePath,
    s3Bucket,
    workbookName: process.env.STAGED_WORKBOOK_UPLOAD_E2E_NAME?.trim() || 'Codex Staged Upload E2E',
  };
}

function isStagedUploadSmokeRequested(): boolean {
  return process.env.STAGED_WORKBOOK_UPLOAD_E2E === 'true';
}

function getStagedUploadSmokeEnv({ s3Bucket }: StagedUploadSmokeConfig): Record<string, string> {
  const env: Record<string, string> = {
    ...getDefaultEnv(),
    MCP_S3_BUCKET: s3Bucket,
    MCP_IMAGE_PREFIX: process.env.MCP_IMAGE_PREFIX?.trim() || 'tableau-mcp-e2e/',
    FILE_TTL: process.env.FILE_TTL?.trim() || '300',
    FEATURE_GATE_PROVIDER: 'custom',
    FEATURE_GATE_PROVIDER_CONFIG: JSON.stringify({
      module: './tests/e2e/fixtures/authoringToolsFeatureGate.cjs',
    }),
  };

  for (const key of [
    'AWS_DEFAULT_REGION',
    'AWS_REGION',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_SESSION_TOKEN',
    'AWS_PROFILE',
    'AWS_SHARED_CREDENTIALS_FILE',
    'AWS_CONFIG_FILE',
    'AWS_SDK_LOAD_CONFIG',
    'HOME',
  ]) {
    const value = process.env[key];
    if (value) {
      env[key] = value;
    }
  }

  return env;
}
