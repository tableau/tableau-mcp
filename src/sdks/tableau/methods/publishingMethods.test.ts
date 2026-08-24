import { AxiosInstance } from 'axios';
import { describe, expect, it, vi } from 'vitest';

import PublishingMethods from './publishingMethods.js';

describe('PublishingMethods', () => {
  describe('initiateFileUpload', () => {
    it('POSTs to fileUploads and returns the upload session', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        data: { fileUpload: { uploadSessionId: 'session-1', fileSize: '0' } },
      });
      const publishingMethods = new PublishingMethods(
        'http://test',
        { type: 'Bearer', token: 'test' },
        {},
      );
      // @ts-expect-error - Mocking private property
      publishingMethods._apiClient = {
        axios: {
          post: mockPost,
          defaults: { baseURL: 'http://test' },
        } as unknown as AxiosInstance,
      };

      const fileUpload = await publishingMethods.initiateFileUpload({ siteId: 'site-1' });

      expect(fileUpload).toEqual({ uploadSessionId: 'session-1', fileSize: 0 });
      const [url, body, config] = mockPost.mock.calls[0];
      expect(url).toBe('http://test/sites/site-1/fileUploads');
      expect(body).toBeUndefined();
      expect(config.headers.Accept).toBe('application/json');
    });
  });

  describe('appendToFileUpload', () => {
    it('PUTs the chunk as multipart form data and returns the updated upload session', async () => {
      const mockPut = vi.fn().mockResolvedValue({
        data: { fileUpload: { uploadSessionId: 'session-1', fileSize: '1024' } },
      });
      const publishingMethods = new PublishingMethods(
        'http://test',
        { type: 'Bearer', token: 'test' },
        {},
      );
      // @ts-expect-error - Mocking private property
      publishingMethods._apiClient = {
        axios: {
          put: mockPut,
          defaults: { baseURL: 'http://test' },
        } as unknown as AxiosInstance,
      };

      const fileUpload = await publishingMethods.appendToFileUpload({
        siteId: 'site-1',
        uploadSessionId: 'session-1',
        filename: 'superstore.twbx',
        chunk: Buffer.from('chunk-bytes'),
      });

      expect(fileUpload).toEqual({ uploadSessionId: 'session-1', fileSize: 1024 });
      const [url, body, config] = mockPut.mock.calls[0];
      expect(url).toBe('http://test/sites/site-1/fileUploads/session-1');
      expect(body.toString('latin1')).toContain(
        'Content-Disposition: form-data; name="tableau_file"; filename="superstore.twbx"',
      );
      expect(config.headers['Content-Type']).toMatch(/^multipart\/mixed; boundary=/);
    });
  });

  describe('uploadFileInChunks', () => {
    it('initiates a session and appends a single chunk for small content', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        data: { fileUpload: { uploadSessionId: 'session-1' } },
      });
      const mockPut = vi.fn().mockResolvedValue({
        data: { fileUpload: { uploadSessionId: 'session-1' } },
      });
      const publishingMethods = new PublishingMethods(
        'http://test',
        { type: 'Bearer', token: 'test' },
        {},
      );
      // @ts-expect-error - Mocking private property
      publishingMethods._apiClient = {
        axios: {
          post: mockPost,
          put: mockPut,
          defaults: { baseURL: 'http://test' },
        } as unknown as AxiosInstance,
      };

      const uploadSessionId = await publishingMethods.uploadFileInChunks({
        siteId: 'site-1',
        filename: 'superstore.twbx',
        content: Buffer.from('small file content'),
      });

      expect(uploadSessionId).toBe('session-1');
      expect(mockPost).toHaveBeenCalledTimes(1);
      expect(mockPut).toHaveBeenCalledTimes(1);
    });

    it('splits content larger than the max chunk size across multiple appends', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        data: { fileUpload: { uploadSessionId: 'session-1' } },
      });
      const mockPut = vi.fn().mockResolvedValue({
        data: { fileUpload: { uploadSessionId: 'session-1' } },
      });
      const publishingMethods = new PublishingMethods(
        'http://test',
        { type: 'Bearer', token: 'test' },
        {},
      );
      // @ts-expect-error - Mocking private property
      publishingMethods._apiClient = {
        axios: {
          post: mockPost,
          put: mockPut,
          defaults: { baseURL: 'http://test' },
        } as unknown as AxiosInstance,
      };

      const maxChunkBytes = 64 * 1024 * 1024;
      const content = Buffer.alloc(maxChunkBytes + 10, 'a');

      const uploadSessionId = await publishingMethods.uploadFileInChunks({
        siteId: 'site-1',
        filename: 'superstore.twbx',
        content,
      });

      expect(uploadSessionId).toBe('session-1');
      expect(mockPost).toHaveBeenCalledTimes(1);
      expect(mockPut).toHaveBeenCalledTimes(2);

      const firstChunkBody = mockPut.mock.calls[0][1];
      const secondChunkBody = mockPut.mock.calls[1][1];
      expect(firstChunkBody.byteLength).toBeGreaterThan(secondChunkBody.byteLength);
    });
  });
});
