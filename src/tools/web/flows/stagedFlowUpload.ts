import { BucketS3Config } from '../s3Client.js';
import {
  buildStagedUploadS3Key,
  getStagedFileType,
  MAX_STAGED_UPLOAD_BYTES,
  requestStagedUpload,
  type ResolvedStagedFile,
  resolveStagedUpload,
  type StagedUploadKind,
} from '../stagedUpload.js';

export const MAX_FLOW_BYTES = 256 * 1024 * 1024;
export const MAX_STAGED_FLOW_BYTES = Math.min(MAX_FLOW_BYTES, MAX_STAGED_UPLOAD_BYTES);
export const FLOW_UPLOAD_PREFIX_SEGMENT = 'flow-uploads';

export type FlowFileType = 'tfl' | 'tflx';

const flowKind: StagedUploadKind<FlowFileType> = {
  prefixSegment: FLOW_UPLOAD_PREFIX_SEGMENT,
  objectStem: 'flow',
  label: 'Prep flow',
  noun: 'Prep flow',
  fileTypes: ['tfl', 'tflx'],
  contentTypes: { tfl: 'application/octet-stream' },
  xmlFileType: 'tfl',
};

export type ResolvedFlow = ResolvedStagedFile;

export type RequestFlowUploadResult = {
  flowUploadId: string;
  uploadUrl: string;
  expiresAt: string;
  maxSizeBytes: number;
  requiredHeaders: Record<string, string>;
};

export async function requestStagedFlowUpload({
  fileName,
  config,
}: {
  fileName: string;
  config: BucketS3Config;
}): Promise<RequestFlowUploadResult> {
  const { uploadId, ...rest } = await requestStagedUpload({
    kind: flowKind,
    fileName,
    config,
  });
  return { flowUploadId: uploadId, ...rest, maxSizeBytes: MAX_FLOW_BYTES };
}

export async function resolveStagedFlowUpload({
  flowUploadId,
  config,
  maxBytes,
}: {
  flowUploadId: string;
  config: BucketS3Config;
  maxBytes?: number;
}): Promise<ResolvedFlow> {
  return await resolveStagedUpload({
    kind: flowKind,
    uploadId: flowUploadId,
    config,
    maxBytes: Math.min(maxBytes ?? MAX_FLOW_BYTES, MAX_FLOW_BYTES),
  });
}

export function buildFlowUploadS3Key(
  keyPrefix: string,
  flowUploadId: string,
  fileType: FlowFileType,
): string {
  return buildStagedUploadS3Key(flowKind, keyPrefix, flowUploadId, fileType);
}

export function getFlowFileType(fileName: string): FlowFileType | undefined {
  return getStagedFileType(flowKind, fileName);
}
