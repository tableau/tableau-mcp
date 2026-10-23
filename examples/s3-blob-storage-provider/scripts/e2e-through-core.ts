/* eslint-disable no-console -- CLI script */
// Loads the BUILT provider through tableau-mcp's real loader (config parsing, require(),
// interface validation), then does one upload/download round trip. Run from the repo root after
// building core and this example; see README.md.
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import {
  getBlobStorageProvider,
  initializeBlobStorageProvider,
} from '../../../src/blobStorage/init.js';

async function main(): Promise<void> {
  // getConfig() validates the whole server config; blob storage itself never contacts SERVER.
  process.env.SERVER ??= 'https://tableau.example.com';
  process.env.PAT_NAME ??= 'unused';
  process.env.PAT_VALUE ??= 'unused';
  process.env.BLOB_STORAGE_PROVIDER = 'custom';
  process.env.BLOB_STORAGE_PROVIDER_CONFIG = JSON.stringify({
    module: resolve(__dirname, '../build/index.js'),
    bucket: process.env.S3_BUCKET ?? 'tmcp-it',
    region: process.env.AWS_REGION ?? 'us-east-1',
    endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:8333',
    forcePathStyle: true,
    keyPrefix: 'e2e',
  });

  initializeBlobStorageProvider();
  const provider = getBlobStorageProvider();
  console.log(`loaded provider: ${provider.constructor.name}`);

  const key = `roundtrip-${randomUUID()}.bin`;
  const bytes = randomBytes(256 * 1024);
  const { url, expiresAt } = await provider.upload({
    key,
    data: (async function* () {
      yield bytes;
    })(),
    contentType: 'application/octet-stream',
    contentLength: bytes.length,
  });
  console.log(`uploaded ${bytes.length} bytes, url expires ${expiresAt}`);

  const fetched = Buffer.from(await (await fetch(url)).arrayBuffer());
  const stream = await provider.download({ key, maxBytes: bytes.length });
  if (!stream) {
    throw new Error('download returned undefined for a key that was just uploaded');
  }
  const pieces: Uint8Array[] = [];
  for await (const piece of stream) {
    pieces.push(piece);
  }
  const downloaded = Buffer.concat(pieces);

  if (!fetched.equals(bytes) || !downloaded.equals(bytes)) {
    throw new Error('round trip bytes did not match');
  }
  console.log('round trip OK (presigned GET and download both match)');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
