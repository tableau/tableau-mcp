import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

export type UploadTwbxParams = {
  bucket: string;
  key: string;
  region: string;
  body: Buffer;
};

/**
 * Uploads a .twbx buffer to S3 using the process default AWS credential chain.
 */
export async function uploadTwbxToS3(params: UploadTwbxParams): Promise<{ etag?: string }> {
  const client = new S3Client({ region: params.region });
  const out = await client.send(
    new PutObjectCommand({
      Bucket: params.bucket,
      Key: params.key,
      Body: params.body,
      ContentType: 'application/vnd.tableau.packaged_workbook',
    }),
  );
  return { etag: out.ETag };
}
