import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { WebMcpServer } from '../../../server.web.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import {
  createPinnedLookup,
  downloadWorkbookFile,
  getInspectWebAuthoringFileInputTool,
  inspectWorkbookFileInput,
} from './inspectWebAuthoringFileInput.js';

const workbookFile = {
  download_url: 'https://files.example.com/generated-workbook.twb',
  file_id: 'file-secret-id',
  mime_type: 'application/octet-stream',
  file_name: 'generated-workbook.twb',
};

const publicAddress = [{ address: '93.184.216.34', family: 4 as const }];

describe('getInspectWebAuthoringFileInputTool', () => {
  it('declares the exact OpenAI file parameter metadata and schema shape', async () => {
    const tool = getInspectWebAuthoringFileInputTool(new WebMcpServer());
    const schema = z.object(await Provider.from(tool.paramsSchema));

    expect(tool.meta).toEqual({ 'openai/fileParams': ['workbookFile'] });
    expect(schema.safeParse({ workbookFile }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ workbookFile: { ...workbookFile, unexpected: true } }).success).toBe(
      false,
    );
    expect(
      schema.safeParse({
        workbookFile: {
          download_url: workbookFile.download_url,
          file_id: workbookFile.file_id,
        },
      }).success,
    ).toBe(true);
  });

  it('passes only redacted file arguments to shared logging', async () => {
    const tool = getInspectWebAuthoringFileInputTool(new WebMcpServer());
    const callback = await Provider.from(tool.callback);
    const logAndExecute = vi
      .spyOn(tool, 'logAndExecute')
      .mockResolvedValue({ isError: false, content: [] } as CallToolResult);

    await callback({ workbookFile }, getMockRequestHandlerExtra());

    const loggedArgs = logAndExecute.mock.calls[0][0].args;
    expect(loggedArgs).toEqual({
      workbookFile: {
        download_url: '<redacted>',
        file_id: '<redacted>',
        mime_type: '<redacted>',
        file_name: 'generated-workbook.twb',
      },
    });
    expect(JSON.stringify(loggedArgs)).not.toContain(workbookFile.download_url);
    expect(JSON.stringify(loggedArgs)).not.toContain(workbookFile.file_id);
  });
});

describe('inspectWorkbookFileInput', () => {
  it('downloads the supplied file and recognizes a TWB root element', async () => {
    const download = vi
      .fn()
      .mockResolvedValue(Buffer.from('<?xml version="1.0"?><workbook><worksheets /></workbook>'));

    await expect(inspectWorkbookFileInput(workbookFile, { download })).resolves.toEqual({
      received: true,
      downloadSucceeded: true,
      fileName: 'generated-workbook.twb',
      mimeType: 'application/octet-stream',
      byteSize: 56,
      hasDownloadUrl: true,
      hasFileId: true,
      isTwb: true,
    });
    expect(download).toHaveBeenCalledWith(workbookFile.download_url);
  });

  it('reports non-TWB XML without returning file contents', async () => {
    const result = await inspectWorkbookFileInput(workbookFile, {
      download: async () => Buffer.from('<datasource />'),
    });

    expect(result.isTwb).toBe(false);
    expect(result).not.toHaveProperty('contents');
    expect(result).not.toHaveProperty('downloadUrl');
    expect(result).not.toHaveProperty('fileId');
  });

  it('sanitizes path-like file names', async () => {
    const result = await inspectWorkbookFileInput(
      { ...workbookFile, file_name: '../../unsafe<>name.twb' },
      { download: async () => Buffer.from('<workbook />') },
    );

    expect(result.fileName).toBe('unsafe__name.twb');
  });
});

describe('createPinnedLookup', () => {
  const address = publicAddress[0];

  it('resolves to the pinned address using the legacy callback form', () => {
    const callback = vi.fn();

    createPinnedLookup(address)('files.example.com', {}, callback);

    expect(callback).toHaveBeenCalledWith(null, address.address, address.family);
  });

  it('resolves to the pinned address using the array callback form when options.all is set', () => {
    const callback = vi.fn();

    createPinnedLookup(address)('files.example.com', { all: true }, callback);

    expect(callback).toHaveBeenCalledWith(null, [
      { address: address.address, family: address.family },
    ]);
  });
});

describe('downloadWorkbookFile', () => {
  it('downloads from a public HTTPS destination', async () => {
    const request = vi.fn().mockResolvedValue({
      status: 200,
      data: Buffer.from('<workbook />'),
    });

    const result = await downloadWorkbookFile(workbookFile.download_url, {
      dependencies: {
        resolveAddresses: async () => publicAddress,
        request,
      },
    });

    expect(result.toString()).toBe('<workbook />');
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: new URL(workbookFile.download_url),
        address: publicAddress[0],
      }),
    );
  });

  it('revalidates the destination after a redirect', async () => {
    const resolveAddresses = vi.fn().mockResolvedValue(publicAddress);
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        status: 302,
        location: 'https://cdn.example.com/generated-workbook.twb',
        data: Buffer.alloc(0),
      })
      .mockResolvedValueOnce({ status: 200, data: Buffer.from('<workbook />') });

    await downloadWorkbookFile(workbookFile.download_url, {
      dependencies: { resolveAddresses, request },
    });

    expect(resolveAddresses).toHaveBeenNthCalledWith(1, 'files.example.com');
    expect(resolveAddresses).toHaveBeenNthCalledWith(2, 'cdn.example.com');
  });

  it('rejects non-HTTPS URLs before making a request', async () => {
    const request = vi.fn();

    await expect(
      downloadWorkbookFile('http://files.example.com/workbook.twb', {
        dependencies: {
          resolveAddresses: async () => publicAddress,
          request,
        },
      }),
    ).rejects.toThrow('not allowed');
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects URLs that resolve to a private address', async () => {
    const request = vi.fn();

    await expect(
      downloadWorkbookFile(workbookFile.download_url, {
        dependencies: {
          resolveAddresses: async () => [{ address: '127.0.0.1', family: 4 }],
          request,
        },
      }),
    ).rejects.toThrow('disallowed network address');
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects a response larger than the configured limit', async () => {
    await expect(
      downloadWorkbookFile(workbookFile.download_url, {
        maxBytes: 4,
        dependencies: {
          resolveAddresses: async () => publicAddress,
          request: async () => ({ status: 200, data: Buffer.alloc(5) }),
        },
      }),
    ).rejects.toThrow('exceeds the 4-byte spike limit');
  });
});
