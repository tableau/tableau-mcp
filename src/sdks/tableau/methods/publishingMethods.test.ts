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

  describe('uploadStreamInChunks', () => {
    function createPublishingMethods(): {
      publishingMethods: PublishingMethods;
      appendedChunks: Buffer[];
      mockPost: ReturnType<typeof vi.fn>;
    } {
      const appendedChunks: Buffer[] = [];
      const mockPost = vi.fn().mockResolvedValue({
        data: { fileUpload: { uploadSessionId: 'session-1' } },
      });
      const publishingMethods = new PublishingMethods(
        'http://test',
        { type: 'Bearer', token: 'test' },
        {},
      );
      // Capture the chunk itself rather than the multipart body so ordering and sizes are exact.
      vi.spyOn(publishingMethods, 'appendToFileUpload').mockImplementation(async ({ chunk }) => {
        appendedChunks.push(Buffer.from(chunk));
        return { uploadSessionId: 'session-1' };
      });
      // @ts-expect-error - Mocking private property
      publishingMethods._apiClient = {
        axios: {
          post: mockPost,
          defaults: { baseURL: 'http://test' },
        } as unknown as AxiosInstance,
      };
      return { publishingMethods, appendedChunks, mockPost };
    }

    it('splits a 150 MB stream into three in-order appends of at most 64 MB', async () => {
      const { publishingMethods, appendedChunks, mockPost } = createPublishingMethods();
      const oneMegabyte = 1024 * 1024;
      async function* stream(): AsyncGenerator<Buffer> {
        for (let index = 0; index < 150; index++) {
          // Tag each MB with its index so reordering would be detected.
          yield Buffer.alloc(oneMegabyte, index);
        }
      }

      const result = await publishingMethods.uploadStreamInChunks({
        siteId: 'site-1',
        filename: 'datasource.tdsx',
        stream: stream(),
      });

      expect(result).toEqual({ uploadSessionId: 'session-1', totalBytes: 150 * oneMegabyte });
      expect(mockPost).toHaveBeenCalledOnce();
      expect(appendedChunks.map((chunk) => chunk.byteLength)).toEqual([
        64 * oneMegabyte,
        64 * oneMegabyte,
        22 * oneMegabyte,
      ]);
      expect(appendedChunks[0][0]).toBe(0);
      expect(appendedChunks[0].at(-1)).toBe(63);
      expect(appendedChunks[1][0]).toBe(64);
      expect(appendedChunks[2][0]).toBe(128);
      expect(appendedChunks[2].at(-1)).toBe(149);
    });

    it('re-chunks pieces that straddle chunk boundaries', async () => {
      const { publishingMethods, appendedChunks } = createPublishingMethods();

      await publishingMethods.uploadStreamInChunks({
        siteId: 'site-1',
        filename: 'datasource.hyper',
        stream: [Buffer.from('abc'), new Uint8Array([100, 101, 102, 103]), 'hij'],
        chunkBytes: 4,
      });

      expect(appendedChunks.map((chunk) => chunk.toString())).toEqual(['abcd', 'efgh', 'ij']);
    });

    it('rejects chunk sizes above the Tableau limit', async () => {
      const { publishingMethods, mockPost } = createPublishingMethods();

      await expect(
        publishingMethods.uploadStreamInChunks({
          siteId: 'site-1',
          filename: 'datasource.tdsx',
          stream: [],
          chunkBytes: 65 * 1024 * 1024,
        }),
      ).rejects.toThrow('chunkBytes must be between');
      expect(mockPost).not.toHaveBeenCalled();
    });
  });
});
