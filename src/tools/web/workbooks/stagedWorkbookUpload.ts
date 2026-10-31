import type { TenantLuids } from '../../../blobStorage/tenantKey.js';
import {
  defineUploadConsumer,
  getUploadFileType,
  MAX_STAGED_UPLOAD_BYTES,
  type ResolvedStagedFileStream,
  resolveStagedUploadStream,
} from '../stagedUpload.js';
import { isWorkbookPublishAvailable } from '../uploadAvailability.js';

export const MAX_STAGED_WORKBOOK_BYTES = MAX_STAGED_UPLOAD_BYTES;
export const WORKBOOK_UPLOAD_PREFIX_SEGMENT = 'workbook-uploads';

export type WorkbookFileType = 'twb' | 'twbx';

const workbookConsumer = defineUploadConsumer<WorkbookFileType>({
  kind: WORKBOOK_UPLOAD_PREFIX_SEGMENT,
  objectStem: 'workbook',
  noun: 'workbook',
  fileTypes: ['twb', 'twbx'],
  xmlFileType: 'twb',
  isAvailable: isWorkbookPublishAvailable,
});

export type ResolvedWorkbook = ResolvedStagedFileStream<WorkbookFileType>;

export async function resolveStagedWorkbookUpload({
  uploadId,
  tenant,
  maxBytes,
}: {
  uploadId: string;
  tenant: TenantLuids;
  maxBytes?: number;
}): Promise<ResolvedWorkbook> {
  return await resolveStagedUploadStream({ consumer: workbookConsumer, uploadId, tenant, maxBytes });
}

export function getWorkbookFileType(fileName: string): WorkbookFileType | undefined {
  return getUploadFileType(workbookConsumer, fileName);
}
