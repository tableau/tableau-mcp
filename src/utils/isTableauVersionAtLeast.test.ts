import { describe, expect, it } from 'vitest';

import { exportedForTesting, getResultForTableauVersion } from './isTableauVersionAtLeast.js';

const { isTableauVersionAtLeast } = exportedForTesting;

describe('getResultForTableauVersion', () => {
  it('should return the result for the given tableau version', async () => {
    const result = await getResultForTableauVersion({
      mappings: {
        '2025.3.0': 'result for 2025.3.0',
        default: 'default result',
      },
      server: 'https://test-server.com',
    });
    expect(result).toBe('result for 2025.3.0');
  });

  it('should return the default result for the given tableau version', async () => {
    const result = await getResultForTableauVersion({
      mappings: {
        '2058.1.0': 'result for 2058.1.0',
        default: 'default result',
      },
      server: 'https://test-server.com',
    });
    expect(result).toBe('default result');
  });
});

describe('isTableauVersionAtLeast', () => {
  it('should return true when version value is "main"', () => {
    const productVersion = {
      value: 'main',
      build: 'main.25.0804.1416',
    };

    expect(isTableauVersionAtLeast({ productVersion, minVersion: '2025.3.0' })).toBe(true);
  });

  it('should return true when version value is in some unknown format', () => {
    const productVersion = {
      value: 'unknown',
      build: 'unknown.25.0804.1416',
    };

    expect(isTableauVersionAtLeast({ productVersion, minVersion: '2025.3.0' })).toBe(true);
  });

  describe('when comparing release versions', () => {
    it('should return true when year is greater', () => {
      const productVersion = {
        value: '2026.1.0',
        build: '20261.25.0804.1416',
      };

      expect(isTableauVersionAtLeast({ productVersion, minVersion: '2025.3.0' })).toBe(true);
    });

    it('should return true when year is equal and major is greater', () => {
      const productVersion = {
        value: '2025.4.0',
        build: '20254.25.0804.1416',
      };

      expect(isTableauVersionAtLeast({ productVersion, minVersion: '2025.3.0' })).toBe(true);
    });

    it('should return true when year and major are equal and minor is greater', () => {
      const productVersion = {
        value: '2025.3.1',
        build: '20253.25.0804.1416',
      };

      expect(isTableauVersionAtLeast({ productVersion, minVersion: '2025.3.0' })).toBe(true);
    });

    it('should return true when versions are exactly equal', () => {
      const productVersion = {
        value: '2025.3.0',
        build: '20253.25.0804.1416',
      };

      expect(isTableauVersionAtLeast({ productVersion, minVersion: '2025.3.0' })).toBe(true);
    });

    it('should return false when year is less', () => {
      const productVersion = {
        value: '2024.3.0',
        build: '20243.25.0804.1416',
      };

      expect(isTableauVersionAtLeast({ productVersion, minVersion: '2025.3.0' })).toBe(false);
    });

    it('should return false when year is equal and major is less', () => {
      const productVersion = {
        value: '2025.2.0',
        build: '20252.25.0804.1416',
      };

      expect(isTableauVersionAtLeast({ productVersion, minVersion: '2025.3.0' })).toBe(false);
    });

    it('should return false when year and major are equal and minor is less', () => {
      const productVersion = {
        value: '2025.3.0',
        build: '20253.25.0804.1416',
      };

      expect(isTableauVersionAtLeast({ productVersion, minVersion: '2025.3.1' })).toBe(false);
    });
  });
});
