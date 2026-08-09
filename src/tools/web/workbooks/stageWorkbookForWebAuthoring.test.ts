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
    const generateUuid = vi.fn().mockReturnValueOnce('new-workbook-id');

    const result = await stageWorkbookForWebAuthoring({
      restApi: {
        siteId: 'site-id',
        fileUploadsMethods: { initiateFileUpload, appendToFileUpload },
        workbooksMethods: { validateUploadedWorkbook },
      },
      server: 'https://tableau.example.com',
      siteName: 'blackbear',
      workbookBytes,
      workbookFileName: 'generated-workbook.twb',
      generateUuid,
    });

    expect(initiateFileUpload).toHaveBeenCalledWith({ siteId: 'site-id' });
    expect(appendToFileUpload).toHaveBeenCalledWith({
      siteId: 'site-id',
      uploadSessionId: 'upload-session-id',
      filename: 'generated-workbook.twb',
      chunk: workbookBytes,
    });
    expect(validateUploadedWorkbook).toHaveBeenCalledWith({
      siteId: 'site-id',
      uploadSessionId: 'upload-session-id',
    });
    expect(result).toEqual({
      uploadSessionId: 'upload-session-id',
      validation,
      authoringUrl:
        'https://tableau.example.com/vizql/show/t/blackbear/authoring/newWorkbook/new-workbook-id/fromFileUpload/upload-session-id',
    });
  });

  it('uses a UUID filename when no safe source filename is supplied', async () => {
    const appendToFileUpload = vi.fn().mockResolvedValue({});
    const generateUuid = vi
      .fn()
      .mockReturnValueOnce('uploaded-workbook-file')
      .mockReturnValueOnce('new-workbook-id');

    await stageWorkbookForWebAuthoring({
      restApi: {
        siteId: 'site-id',
        fileUploadsMethods: {
          initiateFileUpload: vi.fn().mockResolvedValue({ uploadSessionId: 'upload-session-id' }),
          appendToFileUpload,
        },
        workbooksMethods: {
          validateUploadedWorkbook: vi.fn().mockResolvedValue({ errors: [], warnings: [] }),
        },
      },
      server: 'https://tableau.example.com',
      siteName: 'blackbear',
      workbookBytes: Buffer.from('<workbook />'),
      generateUuid,
    });

    expect(appendToFileUpload).toHaveBeenCalledWith(
      expect.objectContaining({ filename: 'uploaded-workbook-file.twb' }),
    );
  });

  it.each([
    ['initiate', 'initiateFileUpload'],
    ['append', 'appendToFileUpload'],
    ['validate', 'validateUploadedWorkbook'],
  ] as const)('sanitizes %s failures', async (expectedStage, failedMethod) => {
    const initiateFileUpload = vi.fn().mockResolvedValue({ uploadSessionId: 'upload-session-id' });
    const appendToFileUpload = vi.fn().mockResolvedValue({});
    const validateUploadedWorkbook = vi.fn().mockResolvedValue({ errors: [], warnings: [] });
    const rawError = new Error('raw multipart and upload-session-id secret');

    if (failedMethod === 'initiateFileUpload') initiateFileUpload.mockRejectedValue(rawError);
    if (failedMethod === 'appendToFileUpload') appendToFileUpload.mockRejectedValue(rawError);
    if (failedMethod === 'validateUploadedWorkbook') {
      validateUploadedWorkbook.mockRejectedValue(rawError);
    }

    await expect(
      stageWorkbookForWebAuthoring({
        restApi: {
          siteId: 'site-id',
          fileUploadsMethods: { initiateFileUpload, appendToFileUpload },
          workbooksMethods: { validateUploadedWorkbook },
        },
        server: 'https://tableau.example.com',
        siteName: 'blackbear',
        workbookBytes: Buffer.from('<workbook />'),
      }),
    ).rejects.toThrow(`Web authoring ${expectedStage} failed.`);
  });

  it('sanitizes handoff construction failures', async () => {
    await expect(
      stageWorkbookForWebAuthoring({
        restApi: {
          siteId: 'site-id',
          fileUploadsMethods: {
            initiateFileUpload: vi.fn().mockResolvedValue({ uploadSessionId: 'upload-session-id' }),
            appendToFileUpload: vi.fn().mockResolvedValue({}),
          },
          workbooksMethods: {
            validateUploadedWorkbook: vi.fn().mockResolvedValue({ errors: [], warnings: [] }),
          },
        },
        server: 'not a URL',
        siteName: 'blackbear',
        workbookBytes: Buffer.from('<workbook />'),
      }),
    ).rejects.toThrow('Web authoring handoff failed.');
  });
});
