import { randomUUID } from 'crypto';

import { RestApi } from '../../../sdks/tableau/restApi.js';
import { WorkbookValidationResult } from '../../../sdks/tableau/types/workbookValidation.js';
import { constructWebAuthoringUrl } from '../utils/authoringUrlUtils.js';

type WebAuthoringRestApi = {
  siteId: string;
  fileUploadsMethods: Pick<
    RestApi['fileUploadsMethods'],
    'initiateFileUpload' | 'appendToFileUpload'
  >;
  workbooksMethods: Pick<RestApi['workbooksMethods'], 'validateUploadedWorkbook'>;
};

export type StageWorkbookForWebAuthoringArgs = {
  restApi: WebAuthoringRestApi;
  server: string;
  siteName: string;
  workbookBytes: Buffer;
  generateUuid?: () => string;
};

export type StagedWebAuthoringWorkbook = {
  validation: WorkbookValidationResult;
  authoringUrl: string;
};

/** Stages a TWB upload, validates it, and constructs its unsaved Web Authoring handoff URL. */
export async function stageWorkbookForWebAuthoring({
  restApi,
  server,
  siteName,
  workbookBytes,
  generateUuid = randomUUID,
}: StageWorkbookForWebAuthoringArgs): Promise<StagedWebAuthoringWorkbook> {
  const { uploadSessionId } = await restApi.fileUploadsMethods.initiateFileUpload({
    siteId: restApi.siteId,
  });

  await restApi.fileUploadsMethods.appendToFileUpload({
    siteId: restApi.siteId,
    uploadSessionId,
    filename: `${generateUuid()}.twb`,
    chunk: workbookBytes,
  });

  const validation = await restApi.workbooksMethods.validateUploadedWorkbook({
    siteId: restApi.siteId,
    uploadSessionId,
  });

  return {
    validation,
    authoringUrl: constructWebAuthoringUrl({
      server,
      siteName,
      workbookId: generateUuid(),
      uploadSessionId,
    }),
  };
}
