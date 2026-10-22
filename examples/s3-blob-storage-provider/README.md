# S3 blob storage provider (reference example)

A reference implementation of tableau-mcp's
[`BlobStorageProvider`](../../src/blobStorage/blobStorageProvider.ts) backed by Amazon S3 (or any
S3-compatible store). It is self-contained: its dependencies live in this directory's
`package.json`, not in tableau-mcp's.

## Build

Build tableau-mcp first, because this example imports the interface type from the built declaration
(`build/blobStorage/blobStorageProvider.d.ts`, the same file published as
`@tableau/mcp-server/blobStorage/blobStorageProvider`):

```bash
npm run build                    # at the tableau-mcp repo root
cd examples/s3-blob-storage-provider
npm install
npm run build                    # emits CommonJS to ./build/index.js
```

## Configure

```bash
BLOB_STORAGE_PROVIDER=custom
BLOB_STORAGE_PROVIDER_CONFIG='{
  "module": "/abs/path/to/examples/s3-blob-storage-provider/build/index.js",
  "bucket": "my-bucket",
  "region": "us-east-1",
  "keyPrefix": "tableau-mcp/",
  "urlTtlSeconds": 900
}'
```

| Field            | Required | Description                                                               |
| ---------------- | -------- | ------------------------------------------------------------------------- |
| `bucket`         | yes      | Target bucket                                                             |
| `region`         | yes      | Bucket region                                                             |
| `endpoint`       | no       | Custom endpoint, e.g. `http://localhost:8333` for a local emulator        |
| `forcePathStyle` | no       | `true` for most S3-compatible stores and emulators                        |
| `keyPrefix`      | no       | Prefix for every object key. Slashes are normalized, so `/a//b/` → `a/b/` |
| `urlTtlSeconds`  | no       | Lifetime of presigned GET/PUT URLs, in seconds (default `900`)            |

Credentials come from the standard AWS SDK chain (env vars, shared config, instance/task role).

The provider's S3 client sets `requestChecksumCalculation: 'WHEN_REQUIRED'`. This is client-wide,
so it also drops the SDK's default CRC32 checksums on normal `upload` calls. It is needed because,
under the default (`WHEN_SUPPORTED`), presigned PUT URLs embed the checksum of an empty body and any
real upload to them fails with `BadDigest`. To keep default checksums on server-side uploads, use a
separate presign-only client with `WHEN_REQUIRED` for `getPresignedUploadUrl` instead.

## IAM permissions

The provider needs these permissions on `arn:aws:s3:::my-bucket/<keyPrefix>*`:

- `s3:PutObject`: `upload` (single PUT and multipart), and presigned PUT URLs
- `s3:GetObject`: `download`, and presigned GET URLs

Presigned URLs carry the signer's permissions, so the principal that runs tableau-mcp must hold
both. Recommended extras:

- `s3:ListBucket` on `arn:aws:s3:::my-bucket`: without it S3 answers a missing key with 403 instead
  of 404, so `download` throws rather than returning `undefined` (only a missing key is treated as
  not found).
- `s3:AbortMultipartUpload`: lets a failed multipart upload clean up its parts.

## Run against a local S3-compatible emulator

Any S3-compatible emulator works. MinIO's community images (`minio/minio`, `quay.io/minio/minio`)
are no longer pullable, so this example is validated against SeaweedFS's S3 gateway. SeaweedFS
enforces SigV4, so give it one identity:

```bash
mkdir -p /tmp/tmcp-s3
cat > /tmp/tmcp-s3/s3.json <<'EOF'
{"identities":[{"name":"test","credentials":[{"accessKey":"test","secretKey":"testtest12"}],"actions":["Admin","Read","Write","List","Tagging"]}]}
EOF
docker run -d --name tmcp-s3 -p 8333:8333 -v /tmp/tmcp-s3/s3.json:/etc/seaweedfs/s3.json:ro \
  chrislusf/seaweedfs server -s3 -s3.config=/etc/seaweedfs/s3.json

export AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=testtest12 AWS_REGION=us-east-1

# Contract tests (create the `tmcp-it` bucket; skipped unless S3_PROVIDER_IT=1)
S3_PROVIDER_IT=1 npx vitest run

# One round trip through tableau-mcp's real loader. Run from the tableau-mcp repo root, after the
# contract tests have created the bucket.
npx tsx examples/s3-blob-storage-provider/scripts/e2e-through-core.ts

docker rm -f tmcp-s3
```

`S3_ENDPOINT` (default `http://localhost:8333`) and `S3_BUCKET` (default `tmcp-it`) override the
target.
