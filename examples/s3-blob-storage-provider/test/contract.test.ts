// Contract tests against a real S3-compatible endpoint. Skipped unless S3_PROVIDER_IT=1.
// See README.md for how to start a local emulator and the env vars used here.
import { randomBytes, randomUUID } from 'node:crypto';

import {
  CreateBucketCommand,
  HeadObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { beforeAll, describe, expect, it } from 'vitest';

import S3BlobStorageProvider from '../src/index.js';

const endpoint = process.env.S3_ENDPOINT ?? 'http://localhost:8333';
const bucket = process.env.S3_BUCKET ?? 'tmcp-it';
const region = process.env.AWS_REGION ?? 'us-east-1';

async function collect(stream: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const pieces: Uint8Array[] = [];
  for await (const piece of stream) {
    pieces.push(piece);
  }
  return Buffer.concat(pieces);
}

async function* chunked(bytes: Buffer, size: number): AsyncIterable<Uint8Array> {
  for (let offset = 0; offset < bytes.length; offset += size) {
    yield bytes.subarray(offset, offset + size);
  }
}

describe.skipIf(process.env.S3_PROVIDER_IT !== '1')(
  'S3BlobStorageProvider (S3-compatible endpoint)',
  () => {
    const raw = new S3Client({ region, endpoint, forcePathStyle: true });
    // Deliberately messy prefix: normalization must store objects under `tmcp/it/<key>`.
    const provider = new S3BlobStorageProvider({
      module: 'unused',
      bucket,
      region,
      endpoint,
      forcePathStyle: true,
      keyPrefix: '/tmcp//it/',
      urlTtlSeconds: 60,
    });

    beforeAll(async () => {
      try {
        await raw.send(new CreateBucketCommand({ Bucket: bucket }));
      } catch (error) {
        if (!(error instanceof S3ServiceException && error.name === 'BucketAlreadyOwnedByYou')) {
          throw error;
        }
      }
    });

    it('uploads with contentLength (single PUT) and serves the bytes from the returned URL', async () => {
      const key = `single-${randomUUID()}.png`;
      const bytes = randomBytes(64 * 1024);

      const { url, expiresAt } = await provider.upload({
        key,
        data: chunked(bytes, 8 * 1024),
        contentType: 'image/png',
        contentLength: bytes.length,
      });

      expect(Date.parse(expiresAt!)).toBeGreaterThan(Date.now());
      const response = await fetch(url);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/png');
      expect(Buffer.from(await response.arrayBuffer()).equals(bytes)).toBe(true);

      const head = await raw.send(new HeadObjectCommand({ Bucket: bucket, Key: `tmcp/it/${key}` }));
      expect(head.ContentLength).toBe(bytes.length);
    });

    it('uploads without contentLength via multipart (>5MB) and the bytes match', async () => {
      const key = `multipart-${randomUUID()}.bin`;
      const bytes = randomBytes(12 * 1024 * 1024);

      const { url } = await provider.upload({
        key,
        data: chunked(bytes, 1024 * 1024),
        contentType: 'application/octet-stream',
      });

      const response = await fetch(url);
      expect(Buffer.from(await response.arrayBuffer()).equals(bytes)).toBe(true);

      // Multipart ETags are `"<md5-of-part-md5s>-<partCount>"`, proving this really went multipart.
      const head = await raw.send(new HeadObjectCommand({ Bucket: bucket, Key: `tmcp/it/${key}` }));
      expect(head.ETag).toMatch(/-\d+"$/);
    });

    it('accepts a direct PUT to the presigned upload URL with requiredHeaders', async () => {
      const key = `presigned-${randomUUID()}.twbx`;
      const bytes = randomBytes(32 * 1024);

      const { uploadUrl, requiredHeaders, expiresAt } = await provider.getPresignedUploadUrl({
        key,
        contentType: 'application/octet-stream',
      });
      expect(requiredHeaders['Content-Type']).toBe('application/octet-stream');
      expect(Date.parse(expiresAt!)).toBeGreaterThan(Date.now());

      const put = await fetch(uploadUrl, { method: 'PUT', headers: requiredHeaders, body: bytes });
      expect(put.status).toBe(200);

      const stream = await provider.download({ key, maxBytes: bytes.length });
      expect(stream).toBeDefined();
      expect((await collect(stream!)).equals(bytes)).toBe(true);
    });

    it('returns undefined when downloading a missing key', async () => {
      await expect(
        provider.download({ key: `missing-${randomUUID()}`, maxBytes: 1024 }),
      ).resolves.toBeUndefined();
    });

    it('rejects instead of returning undefined when the bucket does not exist', async () => {
      const noBucket = new S3BlobStorageProvider({
        module: 'unused',
        bucket: `tmcp-missing-${randomUUID()}`,
        region,
        endpoint,
        forcePathStyle: true,
      });
      await expect(noBucket.download({ key: 'any', maxBytes: 1024 })).rejects.toThrow();
    });

    it('throws instead of truncating when the object exceeds maxBytes', async () => {
      const key = `big-${randomUUID()}.bin`;
      const bytes = randomBytes(2048);
      await provider.upload({
        key,
        data: chunked(bytes, 2048),
        contentType: 'application/octet-stream',
        contentLength: bytes.length,
      });

      await expect(provider.download({ key, maxBytes: 2047 })).rejects.toThrow(/exceeds/);
      const exact = await provider.download({ key, maxBytes: 2048 });
      expect((await collect(exact!)).equals(bytes)).toBe(true);
    });

    it('keeps uploads to different keys separate', async () => {
      const [keyA, keyB] = [`a-${randomUUID()}.txt`, `b-${randomUUID()}.txt`];
      const [bytesA, bytesB] = [Buffer.from('alpha'), Buffer.from('bravo')];

      const [a, b] = await Promise.all([
        provider.upload({
          key: keyA,
          data: chunked(bytesA, 5),
          contentType: 'text/plain',
          contentLength: 5,
        }),
        provider.upload({
          key: keyB,
          data: chunked(bytesB, 5),
          contentType: 'text/plain',
          contentLength: 5,
        }),
      ]);

      expect(a.url).not.toBe(b.url);
      expect(
        (await collect((await provider.download({ key: keyA, maxBytes: 5 }))!)).toString(),
      ).toBe('alpha');
      expect(
        (await collect((await provider.download({ key: keyB, maxBytes: 5 }))!)).toString(),
      ).toBe('bravo');
    });
  },
);
