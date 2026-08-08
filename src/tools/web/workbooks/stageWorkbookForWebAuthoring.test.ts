import { describe, expect, it, vi } from 'vitest';

import { stageWorkbookForWebAuthoring } from './stageWorkbookForWebAuthoring.js';

describe('stageWorkbookForWebAuthoring', () => {
  it('uses the initiated upload session for append, validation, and the handoff URL', async () => {
    const workbookBytes = Buffer.from('<workbook />');
    const validation = {
      timestamp: '2026-08-08T20:00:00Z',
      uploadId: 'upload-session-id',
      errors: [],
      warnings: [],
    };
    const initiateFileUpload = vi.fn().mockResolvedValue({
      uploadSessionId: 'upload-session-id',
      fileSize: 0,
    });
    const appendToFileUpload = vi.fn().mockResolvedValue({
      uploadSessionId: 'upload-session-id',
      fileSize: workbookBytes.length,
    });
    const validateUploadedWorkbook = vi.fn().mockResolvedValue(validation);
    const generateUuid = vi
      .fn()
      .mockReturnValueOnce('uploaded-workbook-file')
      .mockReturnValueOnce('new-workbook-id');

    const result = await stageWorkbookForWebAuthoring({
      restApi: {
        siteId: 'site-id',
        fileUploadsMethods: { initiateFileUpload, appendToFileUpload },
        workbooksMethods: { validateUploadedWorkbook },
      },
      server: 'https://tableau.example.com',
      siteName: 'blackbear',
      workbookBytes,
      generateUuid,
    });

    expect(initiateFileUpload).toHaveBeenCalledWith({ siteId: 'site-id' });
    expect(appendToFileUpload).toHaveBeenCalledWith({
      siteId: 'site-id',
      uploadSessionId: 'upload-session-id',
      filename: 'uploaded-workbook-file.twb',
      chunk: workbookBytes,
    });
    expect(validateUploadedWorkbook).toHaveBeenCalledWith({
      siteId: 'site-id',
      uploadSessionId: 'upload-session-id',
    });
    expect(result).toEqual({
      validation,
      authoringUrl:
        'https://tableau.example.com/vizql/show/t/blackbear/authoring/newWorkbook/new-workbook-id/fromFileUpload/upload-session-id',
    });
  });
});
