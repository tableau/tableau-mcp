import { join } from 'path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config.js', () => ({
  getConfig: vi.fn(() => ({
    blobStorage: { provider: 'noop' },
  })),
}));

import { getConfig } from '../config.js';
import {
  getBlobStorageProvider,
  initializeBlobStorageProvider,
  isBlobStorageEnabled,
  resetBlobStorageProvider,
} from './init.js';
import { NoopBlobStorageProvider } from './noopBlobStorageProvider.js';
import { blobStorageProviderSchema, isBlobStorageProviderType } from './types.js';

describe('BlobStorage', () => {
  beforeEach(() => {
    resetBlobStorageProvider();
    vi.clearAllMocks();
    vi.mocked(getConfig).mockReturnValue({ blobStorage: { provider: 'noop' } } as any);
  });

  describe('provider selection', () => {
    it('should use noop provider by default', () => {
      initializeBlobStorageProvider();
      const provider = getBlobStorageProvider();

      expect(provider).toBeInstanceOf(NoopBlobStorageProvider);
    });

    it('should support lazy initialization without initializeBlobStorageProvider call', () => {
      const provider = getBlobStorageProvider();

      expect(provider).toBeInstanceOf(NoopBlobStorageProvider);
    });

    it('should fall back to noop provider when custom provider module fails to load', () => {
      vi.mocked(getConfig).mockReturnValue({
        blobStorage: {
          provider: 'custom',
          providerConfig: { module: './nonexistent-blob-storage-provider.js' },
        },
      } as any);

      initializeBlobStorageProvider();
      const provider = getBlobStorageProvider();

      expect(provider).toBeInstanceOf(NoopBlobStorageProvider);
    });

    it('should fall back to noop provider on error reading config', () => {
      vi.mocked(getConfig).mockImplementation(() => {
        throw new Error('Config error');
      });

      initializeBlobStorageProvider();
      const provider = getBlobStorageProvider();

      expect(provider).toBeInstanceOf(NoopBlobStorageProvider);
    });

    it('should fall back to noop provider when custom provider fails duck-type validation', () => {
      // Absolute path to a plain-JS fixture that exports a default class missing
      // getPresignedUploadUrl/download, so loadCustomProvider() loads it successfully
      // but validateBlobStorageProvider() rejects it -- exercising the duck-type
      // validation failure path distinct from module-not-found.
      const fixturePath = join(__dirname, '__fixtures__', 'incompleteProvider.js');
      vi.mocked(getConfig).mockReturnValue({
        blobStorage: {
          provider: 'custom',
          providerConfig: { module: fixturePath },
        },
      } as any);

      initializeBlobStorageProvider();
      const provider = getBlobStorageProvider();

      expect(provider).toBeInstanceOf(NoopBlobStorageProvider);
    });
  });

  describe('isBlobStorageEnabled', () => {
    it('should return false when provider is noop', () => {
      initializeBlobStorageProvider();

      expect(isBlobStorageEnabled()).toBe(false);
    });

    it('should return false before initialization (lazy default is noop)', () => {
      getBlobStorageProvider();

      expect(isBlobStorageEnabled()).toBe(false);
    });

    it('should return false when custom provider module fails to load (fallback to noop)', () => {
      vi.mocked(getConfig).mockReturnValue({
        blobStorage: {
          provider: 'custom',
          providerConfig: { module: './nonexistent-blob-storage-provider.js' },
        },
      } as any);

      initializeBlobStorageProvider();

      expect(isBlobStorageEnabled()).toBe(false);
    });

    it('should return false when getConfig throws (fallback to noop)', () => {
      vi.mocked(getConfig).mockImplementation(() => {
        throw new Error('Config error');
      });

      initializeBlobStorageProvider();

      expect(isBlobStorageEnabled()).toBe(false);
    });
  });

  describe('BlobStorage Provider Types', () => {
    describe('blobStorageProviderSchema', () => {
      it('should accept "noop" as valid provider', () => {
        const result = blobStorageProviderSchema.safeParse('noop');
        expect(result.success).toBe(true);
      });

      it('should accept "custom" as valid provider', () => {
        const result = blobStorageProviderSchema.safeParse('custom');
        expect(result.success).toBe(true);
      });

      it('should reject invalid provider values', () => {
        const result = blobStorageProviderSchema.safeParse('invalid');
        expect(result.success).toBe(false);
      });

      it('should reject undefined', () => {
        const result = blobStorageProviderSchema.safeParse(undefined);
        expect(result.success).toBe(false);
      });
    });

    describe('isBlobStorageProviderType', () => {
      it('should return true for "noop"', () => {
        expect(isBlobStorageProviderType('noop')).toBe(true);
      });

      it('should return true for "custom"', () => {
        expect(isBlobStorageProviderType('custom')).toBe(true);
      });

      it('should return false for invalid values', () => {
        expect(isBlobStorageProviderType('invalid')).toBe(false);
        expect(isBlobStorageProviderType(undefined)).toBe(false);
        expect(isBlobStorageProviderType(null)).toBe(false);
        expect(isBlobStorageProviderType(123)).toBe(false);
      });
    });
  });
});
