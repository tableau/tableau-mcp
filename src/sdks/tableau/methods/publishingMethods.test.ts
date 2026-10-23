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
      expect(url).toBe('/sites/site-1/fileUploads');
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
      expect(url).toBe('/sites/site-1/fileUploads/session-1');
      expect(body.toString('latin1')).toContain(
        'Content-Disposition: form-data; name="tableau_file"; filename="superstore.twbx"',
      );
      expect(config.headers['Content-Type']).toMatch(/^multipart\/mixed; boundary=/);
    });
  });

  describe('uploadFileInChunks', () => {
    async function* streamOf(...pieces: Array<string | Uint8Array>): AsyncGenerator<Uint8Array> {
      for (const piece of pieces) {
        yield typeof piece === 'string' ? Buffer.from(piece) : piece;
      }
    }

    function createWithMockedAxios(): {
      publishingMethods: PublishingMethods;
      mockPost: ReturnType<typeof vi.fn>;
      mockPut: ReturnType<typeof vi.fn>;
    } {
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
      return { publishingMethods, mockPost, mockPut };
    }

    it('initiates a session and appends a single chunk for small content', async () => {
      const { publishingMethods, mockPost, mockPut } = createWithMockedAxios();

      const uploadSessionId = await publishingMethods.uploadFileInChunks({
        siteId: 'site-1',
        filename: 'superstore.twbx',
        content: streamOf('small file content'),
        maxBytes: 1024,
      });

      expect(uploadSessionId).toBe('session-1');
      expect(mockPost).toHaveBeenCalledTimes(1);
      expect(mockPut).toHaveBeenCalledTimes(1);
    });

    it('regroups odd-sized pieces across the 64 MB boundary into a full chunk and a remainder', async () => {
      const { publishingMethods, mockPost, mockPut } = createWithMockedAxios();

      const maxChunkBytes = 64 * 1024 * 1024;
      const content = Buffer.alloc(maxChunkBytes + 10, 'a');

      const uploadSessionId = await publishingMethods.uploadFileInChunks({
        siteId: 'site-1',
        filename: 'superstore.twbx',
        content: streamOf(
          content.subarray(0, maxChunkBytes - 3),
          content.subarray(maxChunkBytes - 3, maxChunkBytes + 4),
          content.subarray(maxChunkBytes + 4),
        ),
        maxBytes: content.byteLength,
      });

      expect(uploadSessionId).toBe('session-1');
      expect(mockPost).toHaveBeenCalledTimes(1);
      expect(mockPut).toHaveBeenCalledTimes(2);

      const firstChunkBody = mockPut.mock.calls[0][1];
      const secondChunkBody = mockPut.mock.calls[1][1];
      expect(firstChunkBody.byteLength - secondChunkBody.byteLength).toBe(maxChunkBytes - 10);
    });

    it('appends every byte in order in chunks of at most maxChunkBytes', async () => {
      const { publishingMethods, mockPost } = createWithMockedAxios();
      const appendSpy = vi.spyOn(publishingMethods, 'appendToFileUpload');

      await publishingMethods.uploadFileInChunks({
        siteId: 'site-1',
        filename: 'superstore.twbx',
        content: streamOf('ab', 'cdefg', '', 'h', 'ijklmnopq', 'r'),
        maxBytes: 18,
        maxChunkBytes: 4,
      });

      expect(mockPost).toHaveBeenCalledTimes(1);
      expect(appendSpy.mock.calls.map(([{ chunk }]) => chunk.toString())).toEqual([
        'abcd',
        'efgh',
        'ijkl',
        'mnop',
        'qr',
      ]);
      for (const [args] of appendSpy.mock.calls) {
        expect(args).toMatchObject({
          siteId: 'site-1',
          uploadSessionId: 'session-1',
          filename: 'superstore.twbx',
        });
      }
    });

    it('throws as soon as the content exceeds maxBytes and stops reading the stream', async () => {
      const { publishingMethods } = createWithMockedAxios();
      const pulled: string[] = [];
      async function* trackedStream(): AsyncGenerator<Uint8Array> {
        for (const piece of ['abc', 'def', 'ghi']) {
          pulled.push(piece);
          yield Buffer.from(piece);
        }
      }

      await expect(
        publishingMethods.uploadFileInChunks({
          siteId: 'site-1',
          filename: 'superstore.twbx',
          content: trackedStream(),
          maxBytes: 5,
        }),
      ).rejects.toThrow('File content exceeds the maximum allowed size of 5 bytes.');
      expect(pulled).toEqual(['abc', 'def']);
    });

    it('throws on empty content without creating an upload session', async () => {
      const { publishingMethods, mockPost, mockPut } = createWithMockedAxios();

      await expect(
        publishingMethods.uploadFileInChunks({
          siteId: 'site-1',
          filename: 'superstore.twbx',
          content: streamOf('', new Uint8Array(0)),
          maxBytes: 1024,
        }),
      ).rejects.toThrow('File content must not be empty.');
      expect(mockPost).not.toHaveBeenCalled();
      expect(mockPut).not.toHaveBeenCalled();
    });
  });
});
