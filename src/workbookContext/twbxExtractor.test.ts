/**
 * TWBX Extractor Tests
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

import {
  extractTwbFromTwbx,
  extractTwbFromTwbxFile,
  isExtractionError,
} from './twbxExtractor';

// Path to the test TWBX file
const SUPERSTORE_TWBX_PATH = path.resolve(__dirname, '../../twbs/Superstore.twbx');

describe('TWBX Extractor', () => {
  describe('extractTwbFromTwbx', () => {
    it('should extract TWB from a valid TWBX buffer', () => {
      // Skip if test file doesn't exist
      if (!fs.existsSync(SUPERSTORE_TWBX_PATH)) {
        console.log('Skipping: Superstore.twbx not found');
        return;
      }

      const buffer = fs.readFileSync(SUPERSTORE_TWBX_PATH);
      const result = extractTwbFromTwbx(buffer);

      expect(isExtractionError(result)).toBe(false);
      if (!isExtractionError(result)) {
        expect(result.twbFilename).toMatch(/\.twb$/);
        expect(result.twbXml).toContain('<?xml');
        expect(result.twbXml).toContain('<workbook');
        expect(result.allFiles.length).toBeGreaterThan(0);
      }
    });

    it('should return error for invalid ZIP data', () => {
      const invalidBuffer = Buffer.from('not a zip file');
      const result = extractTwbFromTwbx(invalidBuffer);

      expect(isExtractionError(result)).toBe(true);
      if (isExtractionError(result)) {
        expect(result.type).toBe('invalid-zip');
      }
    });

    it('should return error for ZIP without TWB file', () => {
      // Create a minimal ZIP buffer without any .twb file
      const AdmZip = require('adm-zip');
      const zip = new AdmZip();
      zip.addFile('readme.txt', Buffer.from('Hello'));
      const buffer = zip.toBuffer();

      const result = extractTwbFromTwbx(buffer);

      expect(isExtractionError(result)).toBe(true);
      if (isExtractionError(result)) {
        expect(result.type).toBe('no-twb-found');
        expect(result.message).toContain('readme.txt');
      }
    });

    it('should extract TWB from a custom ZIP with .twb file', () => {
      const AdmZip = require('adm-zip');
      const zip = new AdmZip();
      const twbContent = '<?xml version="1.0"?><workbook></workbook>';
      zip.addFile('Test.twb', Buffer.from(twbContent));
      zip.addFile('Data/extract.hyper', Buffer.from('binary data'));
      const buffer = zip.toBuffer();

      const result = extractTwbFromTwbx(buffer);

      expect(isExtractionError(result)).toBe(false);
      if (!isExtractionError(result)) {
        expect(result.twbFilename).toBe('Test.twb');
        expect(result.twbXml).toBe(twbContent);
        expect(result.allFiles).toContain('Test.twb');
        expect(result.allFiles).toContain('Data/extract.hyper');
      }
    });
  });

  describe('extractTwbFromTwbxFile', () => {
    it('should extract TWB from a file path', async () => {
      // Skip if test file doesn't exist
      if (!fs.existsSync(SUPERSTORE_TWBX_PATH)) {
        console.log('Skipping: Superstore.twbx not found');
        return;
      }

      const result = await extractTwbFromTwbxFile(SUPERSTORE_TWBX_PATH);

      expect(isExtractionError(result)).toBe(false);
      if (!isExtractionError(result)) {
        expect(result.twbFilename).toMatch(/\.twb$/);
        expect(result.twbXml).toContain('<?xml');
      }
    });

    it('should return error for non-existent file', async () => {
      const result = await extractTwbFromTwbxFile('/nonexistent/path.twbx');

      expect(isExtractionError(result)).toBe(true);
      if (isExtractionError(result)) {
        expect(result.type).toBe('extraction-failed');
        expect(result.message).toContain('not found');
      }
    });
  });

  describe('isExtractionError', () => {
    it('should return true for error objects', () => {
      expect(isExtractionError({ type: 'invalid-zip', message: 'test' })).toBe(true);
      expect(isExtractionError({ type: 'no-twb-found', message: 'test' })).toBe(true);
      expect(isExtractionError({ type: 'extraction-failed', message: 'test' })).toBe(true);
    });

    it('should return false for success objects', () => {
      expect(
        isExtractionError({
          twbXml: '<workbook/>',
          twbFilename: 'test.twb',
          allFiles: ['test.twb'],
        })
      ).toBe(false);
    });
  });
});
