import { AxiosInstance } from 'axios';
import { describe, expect, it, vi } from 'vitest';

import FileUploadsMethods from './fileUploadsMethods.js';

describe('FileUploadsMethods', () => {
  describe('initiateFileUpload', () => {
    it('calls the Zodios client and returns the fileUpload payload', async () => {
      const mockApiClient = {
        initiateFileUpload: vi.fn().mockResolvedValue({
          fileUpload: { uploadSessionId: 'session-1', fileSize: 0 },
        }),
      };

      const fileUploadsMethods = new FileUploadsMethods(
        'http://test',
        { type: 'Bearer', token: 'test' },
        {},
      );
      // @ts-expect-error - Mocking private property
      fileUploadsMethods._apiClient = mockApiClient;

      const result = await fileUploadsMethods.initiateFileUpload({ siteId: 'site-1' });

      expect(result).toEqual({ uploadSessionId: 'session-1', fileSize: 0 });
      expect(mockApiClient.initiateFileUpload).toHaveBeenCalledWith(undefined, {
        params: { siteId: 'site-1' },
        headers: { Authorization: 'Bearer test' },
      });
    });
  });

  describe('appendToFileUpload', () => {
    it('PUTs a multipart/mixed body built from the chunk via the raw axios client', async () => {
      const mockPut = vi.fn().mockResolvedValue({
        data: { fileUpload: { uploadSessionId: 'session-1', fileSize: 5 } },
      });
      const fileUploadsMethods = new FileUploadsMethods(
        'http://test',
        { type: 'Bearer', token: 'test' },
        {},
      );
      // @ts-expect-error - Mocking private property
      fileUploadsMethods._apiClient = {
        axios: {
          put: mockPut,
          defaults: { baseURL: 'http://test' },
        } as unknown as AxiosInstance,
      };

      const chunk = Buffer.from('hello');
      const result = await fileUploadsMethods.appendToFileUpload({
        siteId: 'site-1',
        uploadSessionId: 'session-1',
        chunk,
      });

      expect(result).toEqual({ uploadSessionId: 'session-1', fileSize: 5 });
      expect(mockPut).toHaveBeenCalledTimes(1);

      const [url, body, config] = mockPut.mock.calls[0];
      expect(url).toBe('http://test/sites/site-1/fileUploads/session-1');
      expect(Buffer.isBuffer(body)).toBe(true);
      expect(body.toString('latin1')).toContain(
        'Content-Disposition: form-data; name="request_payload"',
      );
      expect(body.toString('latin1')).toContain(
        'Content-Disposition: form-data; name="tableau_file"; filename="file"',
      );
      expect(body.includes(chunk)).toBe(true);
      expect(config.headers['Content-Type']).toMatch(/^multipart\/mixed; boundary=/);
      expect(config.headers.Authorization).toBe('Bearer test');
      expect(config.params).toEqual({ sequenceID: undefined });
    });

    it('passes sequenceId through as the sequenceID query param', async () => {
      const mockPut = vi.fn().mockResolvedValue({
        data: { fileUpload: { uploadSessionId: 'session-1', fileSize: 5 } },
      });
      const fileUploadsMethods = new FileUploadsMethods(
        'http://test',
        { type: 'Bearer', token: 'test' },
        {},
      );
      // @ts-expect-error - Mocking private property
      fileUploadsMethods._apiClient = {
        axios: {
          put: mockPut,
          defaults: { baseURL: 'http://test' },
        } as unknown as AxiosInstance,
      };

      await fileUploadsMethods.appendToFileUpload({
        siteId: 'site-1',
        uploadSessionId: 'session-1',
        chunk: Buffer.from('hello'),
        sequenceId: '3',
      });

      const config = mockPut.mock.calls[0][2];
      expect(config.params).toEqual({ sequenceID: '3' });
    });
  });
});
