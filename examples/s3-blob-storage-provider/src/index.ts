import { Readable } from 'node:stream';

import {
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type { BlobStorageProvider } from '../../../build/blobStorage/blobStorageProvider.js';

export type S3BlobStorageProviderConfig = {
  bucket: string;
  region: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  keyPrefix?: string;
  urlTtlSeconds?: number;
};

const DEFAULT_URL_TTL_SECONDS = 900;

function parseConfig(raw: Record<string, unknown>): S3BlobStorageProviderConfig {
  const { bucket, region, endpoint, forcePathStyle, keyPrefix, urlTtlSeconds } = raw;
  if (typeof bucket !== 'string' || !bucket) {
    throw new Error('S3 blob storage provider requires "bucket" (string)');
  }
  if (typeof region !== 'string' || !region) {
    throw new Error('S3 blob storage provider requires "region" (string)');
  }
  if (endpoint !== undefined && typeof endpoint !== 'string') {
    throw new Error('"endpoint" must be a string');
  }
  if (forcePathStyle !== undefined && typeof forcePathStyle !== 'boolean') {
    throw new Error('"forcePathStyle" must be a boolean');
  }
  if (keyPrefix !== undefined && typeof keyPrefix !== 'string') {
    throw new Error('"keyPrefix" must be a string');
  }
  if (
    urlTtlSeconds !== undefined &&
    (typeof urlTtlSeconds !== 'number' || !Number.isInteger(urlTtlSeconds) || urlTtlSeconds <= 0)
  ) {
    throw new Error('"urlTtlSeconds" must be a positive integer');
  }
  return { bucket, region, endpoint, forcePathStyle, keyPrefix, urlTtlSeconds };
}

/** Trims leading/trailing slashes and collapses repeats, so prefix + key never yields `//`. */
function normalizePrefix(prefix: string | undefined): string {
  const trimmed = (prefix ?? '').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
  return trimmed ? `${trimmed}/` : '';
}

/** Only a missing key is "not found"; other 404s (e.g. NoSuchBucket) are misconfiguration. */
function isNotFound(error: unknown): boolean {
  return (
    error instanceof NoSuchKey ||
    // HEAD-style responses have no error body, so the SDK reports a bare `NotFound`.
    (error instanceof S3ServiceException &&
      error.name === 'NotFound' &&
      error.$metadata.httpStatusCode === 404)
  );
}

/**
 * S3 BlobStorageProvider. Loaded by tableau-mcp via
 * `BLOB_STORAGE_PROVIDER_CONFIG='{"module":".../build/index.js","bucket":"...","region":"..."}'`;
 * core passes the whole config object (including `module`) to the constructor.
 */
export default class S3BlobStorageProvider implements BlobStorageProvider {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly keyPrefix: string;
  private readonly urlTtlSeconds: number;

  constructor(rawConfig: Record<string, unknown>) {
    const config = parseConfig(rawConfig);
    this.bucket = config.bucket;
    this.keyPrefix = normalizePrefix(config.keyPrefix);
    this.urlTtlSeconds = config.urlTtlSeconds ?? DEFAULT_URL_TTL_SECONDS;
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      // The default (WHEN_SUPPORTED) presigns PutObject with the CRC32 of an empty body, so any
      // real upload to the presigned URL fails with BadDigest.
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });
  }

  private objectKey(key: string): string {
    return this.keyPrefix + key.replace(/^\/+/, '');
  }

  private expiresAt(): string {
    return new Date(Date.now() + this.urlTtlSeconds * 1000).toISOString();
  }

  async upload({
    key,
    data,
    contentType,
    contentLength,
  }: Parameters<BlobStorageProvider['upload']>[0]): ReturnType<BlobStorageProvider['upload']> {
    const Key = this.objectKey(key);
    const Body = Readable.from(data);
    try {
      if (contentLength !== undefined) {
        await this.client.send(
          new PutObjectCommand({
            Bucket: this.bucket,
            Key,
            Body,
            ContentLength: contentLength,
            ContentType: contentType,
          }),
        );
      } else {
        await new Upload({
          client: this.client,
          params: { Bucket: this.bucket, Key, Body, ContentType: contentType },
        }).done();
      }
    } catch (error) {
      // Stop pulling from `data` so the caller's source is released.
      Body.destroy();
      throw error;
    }

    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key }),
      { expiresIn: this.urlTtlSeconds },
    );
    return { url, expiresAt: this.expiresAt() };
  }

  async getPresignedUploadUrl({
    key,
    contentType,
  }: Parameters<BlobStorageProvider['getPresignedUploadUrl']>[0]): ReturnType<
    BlobStorageProvider['getPresignedUploadUrl']
  > {
    const uploadUrl = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.objectKey(key),
        ContentType: contentType,
      }),
      // Content-Type is signed, so the uploader must send exactly this value.
      { expiresIn: this.urlTtlSeconds, signableHeaders: new Set(['content-type']) },
    );
    return {
      uploadUrl,
      requiredHeaders: { 'Content-Type': contentType },
      expiresAt: this.expiresAt(),
    };
  }

  async download({
    key,
    maxBytes,
  }: Parameters<BlobStorageProvider['download']>[0]): ReturnType<BlobStorageProvider['download']> {
    let response;
    try {
      response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }),
      );
    } catch (error) {
      if (isNotFound(error)) {
        return undefined;
      }
      throw error;
    }

    const body = response.Body as Readable | undefined;
    if (!body) {
      throw new Error(`S3 returned no body for key "${key}"`);
    }
    if (response.ContentLength !== undefined && response.ContentLength > maxBytes) {
      // Release the socket instead of leaving the unread response open.
      body.destroy();
      throw new Error(
        `Blob "${key}" is ${response.ContentLength} bytes, which exceeds the ${maxBytes}-byte limit`,
      );
    }
    return body;
  }
}
