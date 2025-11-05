import { describe, expect, it } from 'vitest';

import { isTableauVersionAtLeast } from './isTableauVersionAtLeast.js';

describe('isTableauVersionAtLeast', () => {
  it('should return true when version value is "main"', () => {
    const productVersion = {
      value: 'main',
      build: 'main.25.0804.1416',
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
