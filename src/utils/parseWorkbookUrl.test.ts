/**
 * Workbook URL Parser Tests
 */

import { describe, it, expect } from 'vitest';

import {
  parseWorkbookUrl,
  isWorkbookUrlParseError,
  buildWorkbookContentUrlFilter,
} from './parseWorkbookUrl';

describe('parseWorkbookUrl', () => {
  describe('hash-based URLs', () => {
    it('should parse standard hash-based URL', () => {
      const result = parseWorkbookUrl(
        'https://tableau.company.com/#/views/Superstore/Overview'
      );

      expect(isWorkbookUrlParseError(result)).toBe(false);
      if (!isWorkbookUrlParseError(result)) {
        expect(result.workbookContentUrl).toBe('Superstore');
        expect(result.sheetContentUrl).toBe('Overview');
        expect(result.siteName).toBeUndefined();
      }
    });

    it('should parse hash-based URL with query parameters', () => {
      const result = parseWorkbookUrl(
        'https://tableau.company.com/#/views/Superstore/Overview?:iid=1&:embed=yes'
      );

      expect(isWorkbookUrlParseError(result)).toBe(false);
      if (!isWorkbookUrlParseError(result)) {
        expect(result.workbookContentUrl).toBe('Superstore');
        expect(result.sheetContentUrl).toBe('Overview');
      }
    });

    it('should parse hash-based URL without sheet name', () => {
      const result = parseWorkbookUrl(
        'https://tableau.company.com/#/views/Superstore'
      );

      expect(isWorkbookUrlParseError(result)).toBe(false);
      if (!isWorkbookUrlParseError(result)) {
        expect(result.workbookContentUrl).toBe('Superstore');
        expect(result.sheetContentUrl).toBeUndefined();
      }
    });
  });

  describe('path-based URLs', () => {
    it('should parse path-based URL with site', () => {
      const result = parseWorkbookUrl(
        'https://tableau.company.com/t/MySite/views/Superstore/Overview'
      );

      expect(isWorkbookUrlParseError(result)).toBe(false);
      if (!isWorkbookUrlParseError(result)) {
        expect(result.workbookContentUrl).toBe('Superstore');
        expect(result.sheetContentUrl).toBe('Overview');
        expect(result.siteName).toBe('MySite');
      }
    });

    it('should parse path-based URL without site', () => {
      const result = parseWorkbookUrl(
        'https://tableau.company.com/views/Superstore/Overview'
      );

      expect(isWorkbookUrlParseError(result)).toBe(false);
      if (!isWorkbookUrlParseError(result)) {
        expect(result.workbookContentUrl).toBe('Superstore');
        expect(result.sheetContentUrl).toBe('Overview');
        expect(result.siteName).toBeUndefined();
      }
    });
  });

  describe('Tableau Cloud URLs', () => {
    it('should parse Tableau Cloud URL', () => {
      const result = parseWorkbookUrl(
        'https://prod-useast-a.online.tableau.com/#/site/mysite/views/Dashboard/Sheet1'
      );

      expect(isWorkbookUrlParseError(result)).toBe(false);
      if (!isWorkbookUrlParseError(result)) {
        expect(result.workbookContentUrl).toBe('Dashboard');
        expect(result.sheetContentUrl).toBe('Sheet1');
      }
    });
  });

  describe('error cases', () => {
    it('should return error for invalid URL', () => {
      const result = parseWorkbookUrl('not a valid url');

      expect(isWorkbookUrlParseError(result)).toBe(true);
      if (isWorkbookUrlParseError(result)) {
        expect(result.type).toBe('invalid-url');
      }
    });

    it('should return error for URL without views path', () => {
      const result = parseWorkbookUrl('https://tableau.company.com/#/explore');

      expect(isWorkbookUrlParseError(result)).toBe(true);
      if (isWorkbookUrlParseError(result)) {
        expect(result.type).toBe('no-workbook-found');
      }
    });

    it('should return error for URL with empty workbook name', () => {
      const result = parseWorkbookUrl('https://tableau.company.com/#/views/');

      expect(isWorkbookUrlParseError(result)).toBe(true);
      if (isWorkbookUrlParseError(result)) {
        expect(result.type).toBe('no-workbook-found');
      }
    });
  });
});

describe('isWorkbookUrlParseError', () => {
  it('should return true for error objects', () => {
    expect(isWorkbookUrlParseError({ type: 'invalid-url', message: 'test' })).toBe(true);
    expect(isWorkbookUrlParseError({ type: 'no-workbook-found', message: 'test' })).toBe(true);
  });

  it('should return false for success objects', () => {
    const result = parseWorkbookUrl('https://tableau.com/#/views/Test/Sheet');
    expect(isWorkbookUrlParseError(result)).toBe(false);
  });
});

describe('buildWorkbookContentUrlFilter', () => {
  it('should build correct filter string', () => {
    expect(buildWorkbookContentUrlFilter('Superstore')).toBe('contentUrl:eq:Superstore');
    expect(buildWorkbookContentUrlFilter('My-Dashboard')).toBe('contentUrl:eq:My-Dashboard');
  });
});
