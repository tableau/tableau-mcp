import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config.js', () => ({
  getConfig: vi.fn(() => ({
    uploadUrl: { provider: 'server' },
  })),
}));

const mocks = vi.hoisted(() => ({
  createPresignedPutUrlToS3: vi.fn(),
}));

vi.mock('../tools/web/s3Client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tools/web/s3Client.js')>()),
  createPresignedPutUrlToS3: mocks.createPresignedPutUrlToS3,
}));

import { getConfig } from '../config.js';
import {
  getUploadUrlProvider,
  initializeUploadUrlProvider,
  resetUploadUrlProvider,
} from './init.js';
import { isUploadUrlProvider, uploadUrlProviderSchema } from './types.js';

const params = {
  workbookUploadId: '123e4567-e89b-42d3-a456-426614174000',
  key: 'mcp/workbook-uploads/123e4567-e89b-42d3-a456-426614174000/workbook.twb',
  bucket: 'tableau-workbooks',
  region: 'us-east-1',
  contentType: 'application/xml',
  presignTtlSeconds: 300,
};

describe('UploadUrlProvider', () => {
  beforeEach(() => {
    resetUploadUrlProvider();
    vi.clearAllMocks();
    mocks.createPresignedPutUrlToS3.mockResolvedValue('https://s3.example.com/signed-put');
    vi.mocked(getConfig).mockReturnValue({ uploadUrl: { provider: 'server' } } as any);
  });

  describe('provider selection', () => {
    it('should use the server provider by default and delegate to createPresignedPutUrlToS3', async () => {
      initializeUploadUrlProvider();
      const provider = getUploadUrlProvider();

      const result = await provider.getUploadUrl(params);

      expect(result).toEqual({
        uploadUrl: 'https://s3.example.com/signed-put',
        requiredHeaders: { 'Content-Type': 'application/xml' },
      });
      expect(mocks.createPresignedPutUrlToS3).toHaveBeenCalledWith({
        key: params.key,
        contentType: 'application/xml',
        bucket: 'tableau-workbooks',
        region: 'us-east-1',
        presignTtlSeconds: 300,
      });
    });

    it('should support lazy initialization without initializeUploadUrlProvider call', async () => {
      const provider = getUploadUrlProvider();

      const result = await provider.getUploadUrl(params);

      expect(result.uploadUrl).toBe('https://s3.example.com/signed-put');
      expect(mocks.createPresignedPutUrlToS3).toHaveBeenCalled();
    });

    it('should fall back to the server provider when the custom module fails to load', async () => {
      vi.mocked(getConfig).mockReturnValue({
        uploadUrl: {
          provider: 'custom',
          providerConfig: { module: './nonexistent-provider.js' },
        },
      } as any);

      initializeUploadUrlProvider();
      const provider = getUploadUrlProvider();

      // Should fall back to server provider (delegates to createPresignedPutUrlToS3)
      const result = await provider.getUploadUrl(params);
      expect(result.requiredHeaders).toEqual({ 'Content-Type': 'application/xml' });
      expect(mocks.createPresignedPutUrlToS3).toHaveBeenCalled();
    });

    it('should fall back to the server provider on config error', async () => {
      vi.mocked(getConfig).mockImplementation(() => {
        throw new Error('Config error');
      });

      initializeUploadUrlProvider();
      const provider = getUploadUrlProvider();

      const result = await provider.getUploadUrl(params);
      expect(result.uploadUrl).toBe('https://s3.example.com/signed-put');
      expect(mocks.createPresignedPutUrlToS3).toHaveBeenCalled();
    });
  });

  describe('custom provider loading', () => {
    let fixtureDir: string;

    beforeEach(() => {
      fixtureDir = mkdtempSync(join(tmpdir(), 'upload-url-provider-'));
    });

    afterEach(() => {
      rmSync(fixtureDir, { recursive: true, force: true });
    });

    it('should load a custom provider from a module path and use its returned URL/headers', async () => {
      const modulePath = join(fixtureDir, 'good-provider.cjs');
      writeFileSync(
        modulePath,
        `module.exports = {
          default: class {
            async getUploadUrl() {
              return {
                uploadUrl: 'https://mcp.tableau.com/upload/first-party',
                requiredHeaders: { 'X-Upload-Token': 'abc' },
              };
            }
          },
        };`,
      );
      vi.mocked(getConfig).mockReturnValue({
        uploadUrl: { provider: 'custom', providerConfig: { module: modulePath } },
      } as any);

      initializeUploadUrlProvider();
      const provider = getUploadUrlProvider();

      const result = await provider.getUploadUrl(params);
      expect(result).toEqual({
        uploadUrl: 'https://mcp.tableau.com/upload/first-party',
        requiredHeaders: { 'X-Upload-Token': 'abc' },
      });
      // Custom provider does not touch the default S3 presign path.
      expect(mocks.createPresignedPutUrlToS3).not.toHaveBeenCalled();
    });

    it('should fall back to the server provider when the custom module fails duck-type validation', async () => {
      const modulePath = join(fixtureDir, 'bad-provider.cjs');
      // Exported as a named export so the loader resolves the class and then
      // fails on duck-type validation (missing getUploadUrl), not on resolution.
      writeFileSync(
        modulePath,
        'module.exports = { UploadUrlProvider: class { someOtherMethod() {} } };',
      );
      vi.mocked(getConfig).mockReturnValue({
        uploadUrl: { provider: 'custom', providerConfig: { module: modulePath } },
      } as any);

      initializeUploadUrlProvider();
      const provider = getUploadUrlProvider();

      // Missing getUploadUrl -> validation throws -> falls back to server provider.
      const result = await provider.getUploadUrl(params);
      expect(result.uploadUrl).toBe('https://s3.example.com/signed-put');
      expect(mocks.createPresignedPutUrlToS3).toHaveBeenCalled();
    });
  });

  describe('Upload URL Provider Types', () => {
    describe('uploadUrlProviderSchema', () => {
      it('should accept "server" as valid provider', () => {
        expect(uploadUrlProviderSchema.safeParse('server').success).toBe(true);
      });

      it('should accept "custom" as valid provider', () => {
        expect(uploadUrlProviderSchema.safeParse('custom').success).toBe(true);
      });

      it('should reject invalid provider values', () => {
        expect(uploadUrlProviderSchema.safeParse('invalid').success).toBe(false);
      });

      it('should reject undefined', () => {
        expect(uploadUrlProviderSchema.safeParse(undefined).success).toBe(false);
      });
    });

    describe('isUploadUrlProvider', () => {
      it('should return true for "server"', () => {
        expect(isUploadUrlProvider('server')).toBe(true);
      });

      it('should return true for "custom"', () => {
        expect(isUploadUrlProvider('custom')).toBe(true);
      });

      it('should return false for invalid values', () => {
        expect(isUploadUrlProvider('invalid')).toBe(false);
        expect(isUploadUrlProvider(undefined)).toBe(false);
        expect(isUploadUrlProvider(null)).toBe(false);
        expect(isUploadUrlProvider(123)).toBe(false);
      });
    });
  });
});
