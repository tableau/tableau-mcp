/**
 * TWBX Storage Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';

import {
  storeTwbx,
  getTwbx,
  getTwbxMetadata,
  findTwbxByWorkbookId,
  listAllTwbx,
  deleteTwbx,
  clearAllTwbx,
  getStorageDir,
} from './twbxStorage';

describe('TWBX Storage', () => {
  const testContent = Buffer.from('PK\x03\x04 fake twbx content');
  const testWorkbookId = 'test-workbook-id-123';
  const testWorkbookName = 'Test Workbook';

  // Clean up after each test
  afterEach(async () => {
    await clearAllTwbx();
  });

  describe('storeTwbx', () => {
    it('should store TWBX and return metadata', async () => {
      const metadata = await storeTwbx({
        content: testContent,
        workbookId: testWorkbookId,
        workbookName: testWorkbookName,
      });

      expect(metadata.id).toBeDefined();
      expect(metadata.filename).toContain('Test_Workbook');
      expect(metadata.filename).toMatch(/\.twbx$/);
      expect(metadata.workbookId).toBe(testWorkbookId);
      expect(metadata.workbookName).toBe(testWorkbookName);
      expect(metadata.fileSize).toBe(testContent.length);
      expect(metadata.storedAt).toBeDefined();
      expect(metadata.filePath).toContain(getStorageDir());
    });

    it('should create storage directory if it does not exist', async () => {
      const metadata = await storeTwbx({
        content: testContent,
        workbookId: testWorkbookId,
        workbookName: testWorkbookName,
      });

      // Verify file was created
      const stats = await fs.stat(metadata.filePath);
      expect(stats.isFile()).toBe(true);
      expect(stats.size).toBe(testContent.length);
    });

    it('should sanitize workbook name for filename', async () => {
      const metadata = await storeTwbx({
        content: testContent,
        workbookId: testWorkbookId,
        workbookName: 'My/Workbook:With*Special?Chars',
      });

      expect(metadata.filename).not.toContain('/');
      expect(metadata.filename).not.toContain(':');
      expect(metadata.filename).not.toContain('*');
      expect(metadata.filename).not.toContain('?');
    });
  });

  describe('getTwbx', () => {
    it('should retrieve stored TWBX content', async () => {
      const metadata = await storeTwbx({
        content: testContent,
        workbookId: testWorkbookId,
        workbookName: testWorkbookName,
      });

      const retrieved = await getTwbx(metadata.id);

      expect(retrieved).toBeDefined();
      expect(retrieved).toEqual(testContent);
    });

    it('should return undefined for non-existent ID', async () => {
      const retrieved = await getTwbx('non-existent-id');
      expect(retrieved).toBeUndefined();
    });
  });

  describe('getTwbxMetadata', () => {
    it('should return metadata for stored TWBX', async () => {
      const stored = await storeTwbx({
        content: testContent,
        workbookId: testWorkbookId,
        workbookName: testWorkbookName,
      });

      const metadata = getTwbxMetadata(stored.id);

      expect(metadata).toBeDefined();
      expect(metadata?.id).toBe(stored.id);
      expect(metadata?.workbookId).toBe(testWorkbookId);
    });

    it('should return undefined for non-existent ID', () => {
      const metadata = getTwbxMetadata('non-existent-id');
      expect(metadata).toBeUndefined();
    });
  });

  describe('findTwbxByWorkbookId', () => {
    it('should find TWBX by workbook ID', async () => {
      await storeTwbx({
        content: testContent,
        workbookId: testWorkbookId,
        workbookName: testWorkbookName,
      });

      const found = findTwbxByWorkbookId(testWorkbookId);

      expect(found).toBeDefined();
      expect(found?.workbookId).toBe(testWorkbookId);
    });

    it('should return undefined for non-existent workbook ID', () => {
      const found = findTwbxByWorkbookId('non-existent-workbook');
      expect(found).toBeUndefined();
    });
  });

  describe('listAllTwbx', () => {
    it('should list all stored TWBX files', async () => {
      await storeTwbx({
        content: testContent,
        workbookId: 'workbook-1',
        workbookName: 'Workbook One',
      });
      await storeTwbx({
        content: testContent,
        workbookId: 'workbook-2',
        workbookName: 'Workbook Two',
      });

      const all = listAllTwbx();

      expect(all.length).toBe(2);
      expect(all.map((m) => m.workbookId)).toContain('workbook-1');
      expect(all.map((m) => m.workbookId)).toContain('workbook-2');
    });

    it('should return empty array when no TWBX stored', () => {
      const all = listAllTwbx();
      expect(all).toEqual([]);
    });
  });

  describe('deleteTwbx', () => {
    it('should delete stored TWBX', async () => {
      const metadata = await storeTwbx({
        content: testContent,
        workbookId: testWorkbookId,
        workbookName: testWorkbookName,
      });

      const deleted = await deleteTwbx(metadata.id);

      expect(deleted).toBe(true);
      expect(getTwbxMetadata(metadata.id)).toBeUndefined();

      // Verify file was deleted
      await expect(fs.access(metadata.filePath)).rejects.toThrow();
    });

    it('should return false for non-existent ID', async () => {
      const deleted = await deleteTwbx('non-existent-id');
      expect(deleted).toBe(false);
    });
  });

  describe('clearAllTwbx', () => {
    it('should clear all stored TWBX files', async () => {
      await storeTwbx({
        content: testContent,
        workbookId: 'workbook-1',
        workbookName: 'Workbook One',
      });
      await storeTwbx({
        content: testContent,
        workbookId: 'workbook-2',
        workbookName: 'Workbook Two',
      });

      await clearAllTwbx();

      expect(listAllTwbx()).toEqual([]);
    });
  });
});
