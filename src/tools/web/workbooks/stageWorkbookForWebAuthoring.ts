import { randomUUID } from 'crypto';

import { WebAuthoringStageError } from '../../../errors/mcpToolError.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';
import { WorkbookValidationResult } from '../../../sdks/tableau/types/workbookValidation.js';
import { getHttpStatus } from '../../../utils/getHttpStatus.js';
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
  workbookFileName?: string;
  generateUuid?: () => string;
};

export type StagedWebAuthoringWorkbook = {
  uploadSessionId: string;
  validation: WorkbookValidationResult;
  authoringUrl: string;
};

/** Stages a TWB upload, validates it, and constructs its unsaved Web Authoring handoff URL. */
export async function stageWorkbookForWebAuthoring({
  restApi,
  server,
  siteName,
  workbookBytes,
  workbookFileName,
  generateUuid = randomUUID,
}: StageWorkbookForWebAuthoringArgs): Promise<StagedWebAuthoringWorkbook> {
  const { uploadSessionId } = await runStage('initiate', async () =>
    restApi.fileUploadsMethods.initiateFileUpload({
      siteId: restApi.siteId,
    }),
  );

  await runStage('append', async () =>
    restApi.fileUploadsMethods.appendToFileUpload({
      siteId: restApi.siteId,
      uploadSessionId,
      filename: workbookFileName ?? `${generateUuid()}.twb`,
      chunk: workbookBytes,
    }),
  );

  const validation = await runStage('validate', async () =>
    restApi.workbooksMethods.validateUploadedWorkbook({
      siteId: restApi.siteId,
      uploadSessionId,
    }),
  );

  return {
    uploadSessionId,
    validation,
    authoringUrl: await runStage('handoff', async () =>
      constructWebAuthoringUrl({
        server,
        siteName,
        workbookId: generateUuid(),
        uploadSessionId,
      }),
    ),
  };
}

async function runStage<T>(
  stage: 'initiate' | 'append' | 'validate' | 'handoff',
  callback: () => Promise<T> | T,
): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    const httpStatus = error instanceof Error ? getHttpStatus(error) : '';
    throw new WebAuthoringStageError(stage, httpStatus || undefined);
  }
}
