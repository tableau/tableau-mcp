import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config.js', () => ({
  getConfig: vi.fn(() => ({ blobStorage: undefined })),
}));

import { getConfig } from '../config.js';
import {
  getBlobStorageProvider,
  initializeBlobStorageProvider,
  isBlobStorageEnabled,
  resetBlobStorageProvider,
} from './init.js';
import { blobStorageProviderSchema, isBlobStorageProviderType } from './types.js';

// Plain-JS fixture missing getPresignedUploadUrl/download: loads, then fails duck-type validation.
const incompleteProviderPath = join(__dirname, '__fixtures__', 'incompleteProvider.js');

function mockCustomConfig(module: string): void {
  vi.mocked(getConfig).mockReturnValue({
    blobStorage: { provider: 'custom', providerConfig: { module } },
  } as any);
}

describe('BlobStorage', () => {
  beforeEach(() => {
    resetBlobStorageProvider();
    vi.clearAllMocks();
    vi.mocked(getConfig).mockReturnValue({ blobStorage: undefined } as any);
  });

  describe('provider selection', () => {
    it('should configure no provider when blob storage is unset', () => {
      expect(initializeBlobStorageProvider()).toBeUndefined();
      expect(isBlobStorageEnabled()).toBe(false);
      expect(() => getBlobStorageProvider()).toThrow(/Internal error/);
    });

    it('should not be enabled before initialization', () => {
      expect(isBlobStorageEnabled()).toBe(false);
      expect(() => getBlobStorageProvider()).toThrow(/Check isBlobStorageEnabled\(\) first/);
    });

    it('should load a valid custom provider', () => {
      mockCustomConfig(join(__dirname, '__fixtures__', 'validProvider.js'));

      const provider = initializeBlobStorageProvider();

      expect(provider).toBeDefined();
      expect(isBlobStorageEnabled()).toBe(true);
      expect(getBlobStorageProvider()).toBe(provider);
    });

    it('should throw when the custom provider module is not found', () => {
      mockCustomConfig('./nonexistent-blob-storage-provider.js');

      expect(() => initializeBlobStorageProvider()).toThrow(/Module not found/);
      expect(isBlobStorageEnabled()).toBe(false);
    });

    it('should throw when the custom provider fails duck-type validation', () => {
      mockCustomConfig(incompleteProviderPath);

      expect(() => initializeBlobStorageProvider()).toThrow(
        /missing required methods: getPresignedUploadUrl, download/,
      );
      expect(isBlobStorageEnabled()).toBe(false);
    });

    it('should propagate errors reading config', () => {
      vi.mocked(getConfig).mockImplementation(() => {
        throw new Error('Config error');
      });

      expect(() => initializeBlobStorageProvider()).toThrow('Config error');
      expect(isBlobStorageEnabled()).toBe(false);
    });
  });

  describe('BlobStorage Provider Types', () => {
    describe('blobStorageProviderSchema', () => {
      it('should accept "custom" as valid provider', () => {
        const result = blobStorageProviderSchema.safeParse('custom');
        expect(result.success).toBe(true);
      });

      it('should reject invalid provider values, including "noop"', () => {
        expect(blobStorageProviderSchema.safeParse('invalid').success).toBe(false);
        expect(blobStorageProviderSchema.safeParse('noop').success).toBe(false);
      });

      it('should reject undefined', () => {
        const result = blobStorageProviderSchema.safeParse(undefined);
        expect(result.success).toBe(false);
      });
    });

    describe('isBlobStorageProviderType', () => {
      it('should return true for "custom"', () => {
        expect(isBlobStorageProviderType('custom')).toBe(true);
      });

      it('should return false for invalid values', () => {
        expect(isBlobStorageProviderType('invalid')).toBe(false);
        expect(isBlobStorageProviderType('noop')).toBe(false);
        expect(isBlobStorageProviderType(undefined)).toBe(false);
        expect(isBlobStorageProviderType(null)).toBe(false);
        expect(isBlobStorageProviderType(123)).toBe(false);
      });
    });
  });
});
