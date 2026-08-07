import { describe, expect, it, vi } from 'vitest';

import WorkbooksMethods from './workbooksMethods.js';

describe('WorkbooksMethods', () => {
  describe('validateUploadedWorkbook', () => {
    it('should pass siteId as a path param, uploadSessionId as a query, and an undefined body', async () => {
      const mockApiClient = {
        validateUploadedWorkbook: vi.fn().mockResolvedValue({
          timestamp: '2026-06-10T14:32:18.456Z',
          uploadId: '12345:abc',
        }),
      };

      const workbooksMethods = new WorkbooksMethods(
        'http://test',
        { type: 'Bearer', token: 'test' },
        {},
      );
      // @ts-expect-error - Mocking private property
      workbooksMethods._apiClient = mockApiClient;

      await workbooksMethods.validateUploadedWorkbook({
        siteId: 'site-1',
        uploadSessionId: 'session-42',
      });

      expect(mockApiClient.validateUploadedWorkbook).toHaveBeenCalledWith(
        undefined,
        expect.objectContaining({
          params: { siteId: 'site-1' },
          queries: { uploadSessionId: 'session-42' },
        }),
      );
    });

    it('should return a successful validation result including warnings', async () => {
      const result = {
        timestamp: '2026-06-10T14:32:18.456Z',
        uploadId: '12345:abc',
        warnings: [
          {
            severity: 'WARNING',
            message: 'Unknown map source is used',
            line: 245,
            column: 18,
            elementName: 'map',
          },
        ],
      };
      const mockApiClient = {
        validateUploadedWorkbook: vi.fn().mockResolvedValue(result),
      };

      const workbooksMethods = new WorkbooksMethods(
        'http://test',
        { type: 'Bearer', token: 'test' },
        {},
      );
      // @ts-expect-error - Mocking private property
      workbooksMethods._apiClient = mockApiClient;

      const validation = await workbooksMethods.validateUploadedWorkbook({
        siteId: 'site-1',
        uploadSessionId: 'session-42',
      });

      expect(validation).toEqual(result);
    });

    it('should return a validation result carrying structured errors and warnings', async () => {
      const result = {
        timestamp: '2026-06-10T14:32:18.456Z',
        errors: [
          {
            severity: 'ERROR',
            message: 'Missing required closing tag for element',
            line: 127,
            column: 5,
            elementName: 'preferences',
          },
        ],
        warnings: [
          {
            severity: 'WARNING',
            message: 'Unknown map source is used',
            line: 245,
            column: 18,
            elementName: 'map',
          },
        ],
      };
      const mockApiClient = {
        validateUploadedWorkbook: vi.fn().mockResolvedValue(result),
      };

      const workbooksMethods = new WorkbooksMethods(
        'http://test',
        { type: 'Bearer', token: 'test' },
        {},
      );
      // @ts-expect-error - Mocking private property
      workbooksMethods._apiClient = mockApiClient;

      const validation = await workbooksMethods.validateUploadedWorkbook({
        siteId: 'site-1',
        uploadSessionId: 'session-42',
      });

      expect(validation.errors).toEqual(result.errors);
      expect(validation.warnings).toEqual(result.warnings);
      expect(validation.uploadId).toBeUndefined();
    });
  });
});
