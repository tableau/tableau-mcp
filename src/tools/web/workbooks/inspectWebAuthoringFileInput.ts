import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { DOMParser } from '@xmldom/xmldom';
import { lookup } from 'dns/promises';
import { Agent as HttpsAgent } from 'https';
import { isIP } from 'net';
import { isSSRFSafeURL } from 'ssrfcheck';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { WebMcpServer } from '../../../server.web.js';
import { axios, getStringResponseHeader } from '../../../utils/axios.js';
import { WebTool } from '../tool.js';

export const SPIKE_MAX_WORKBOOK_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const DOWNLOAD_TIMEOUT_MS = 10_000;

export const openAIFileSchema = z
  .object({
    download_url: z.string(),
    file_id: z.string(),
    mime_type: z.string().optional(),
    file_name: z.string().optional(),
  })
  .strict();

const paramsSchema = {
  workbookFile: openAIFileSchema,
};

export type OpenAIFile = z.infer<typeof openAIFileSchema>;

export type WorkbookFileInspection = {
  received: true;
  downloadSucceeded: true;
  fileName: string | null;
  mimeType: string | null;
  byteSize: number;
  hasDownloadUrl: true;
  hasFileId: true;
  isTwb: boolean;
};

type ResolvedAddress = {
  address: string;
  family: 4 | 6;
};

type DownloadResponse = {
  status: number;
  location?: string;
  data: Buffer;
};

type DownloadDependencies = {
  resolveAddresses: (hostname: string) => Promise<ReadonlyArray<ResolvedAddress>>;
  request: (args: {
    url: URL;
    address: ResolvedAddress;
    maxBytes: number;
    timeoutMs: number;
    signal?: AbortSignal;
  }) => Promise<DownloadResponse>;
};

type DownloadWorkbookFileOptions = {
  maxBytes?: number;
  maxRedirects?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  dependencies?: Partial<DownloadDependencies>;
};

type InspectWorkbookFileOptions = {
  download?: (downloadUrl: string) => Promise<Buffer>;
};

export const getInspectWebAuthoringFileInputTool = (
  server: WebMcpServer,
): WebTool<typeof paramsSchema> => {
  const tool = new WebTool({
    server,
    name: 'inspect-web-authoring-file-input',
    description:
      'Temporary development probe that verifies ChatGPT can pass a generated or attached Tableau TWB file to an MCP tool. Downloads the file with strict limits and reports only non-secret metadata and whether the bytes form a TWB. It does not contact Tableau or create an authoring session.',
    paramsSchema,
    annotations: {
      title: 'Inspect Web Authoring File Input',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    meta: {
      'openai/fileParams': ['workbookFile'],
    },
    callback: async ({ workbookFile }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute<WorkbookFileInspection>({
        extra,
        args: {
          workbookFile: {
            download_url: '<redacted>',
            file_id: '<redacted>',
            mime_type: workbookFile.mime_type ? '<redacted>' : undefined,
            file_name: sanitizeFileName(workbookFile.file_name),
          },
        },
        callback: async () => Ok(await inspectWorkbookFileInput(workbookFile)),
        constrainSuccessResult: (result) => ({ type: 'success', result }),
        getSuccessResult: (result) => ({
          isError: false,
          structuredContent: result,
          content: [{ type: 'text', text: JSON.stringify(result) }],
        }),
      });
    },
  });

  return tool;
};

export async function inspectWorkbookFileInput(
  workbookFile: OpenAIFile,
  options: InspectWorkbookFileOptions = {},
): Promise<WorkbookFileInspection> {
  if (!workbookFile.download_url || !workbookFile.file_id) {
    throw new Error('ChatGPT did not provide a complete workbook file reference');
  }

  const download = options.download ?? ((url) => downloadWorkbookFile(url));
  const bytes = await download(workbookFile.download_url);

  return {
    received: true,
    downloadSucceeded: true,
    fileName: sanitizeFileName(workbookFile.file_name) ?? null,
    mimeType: sanitizeMimeType(workbookFile.mime_type) ?? null,
    byteSize: bytes.byteLength,
    hasDownloadUrl: true,
    hasFileId: true,
    isTwb: isTwbXml(bytes),
  };
}

export async function downloadWorkbookFile(
  downloadUrl: string,
  options: DownloadWorkbookFileOptions = {},
): Promise<Buffer> {
  const maxBytes = options.maxBytes ?? SPIKE_MAX_WORKBOOK_BYTES;
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
  const timeoutMs = options.timeoutMs ?? DOWNLOAD_TIMEOUT_MS;
  const dependencies: DownloadDependencies = {
    resolveAddresses: options.dependencies?.resolveAddresses ?? resolvePublicAddresses,
    request: options.dependencies?.request ?? requestWorkbookFile,
  };

  let currentUrl = parseDownloadUrl(downloadUrl);
  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    assertAllowedDownloadUrl(currentUrl);
    const addresses = await dependencies.resolveAddresses(currentUrl.hostname);
    const address = requirePublicAddress(addresses);
    const response = await dependencies.request({
      url: currentUrl,
      address,
      maxBytes,
      timeoutMs,
      signal: options.signal,
    });

    if (isRedirect(response.status)) {
      if (!response.location || redirectCount === maxRedirects) {
        throw new Error('Workbook file download exceeded the redirect limit');
      }
      currentUrl = parseDownloadUrl(new URL(response.location, currentUrl).toString());
      continue;
    }

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Workbook file download failed with HTTP ${response.status}`);
    }
    if (response.data.byteLength > maxBytes) {
      throw new Error(`Workbook file exceeds the ${maxBytes}-byte spike limit`);
    }

    return response.data;
  }

  throw new Error('Workbook file download exceeded the redirect limit');
}

async function resolvePublicAddresses(hostname: string): Promise<ReadonlyArray<ResolvedAddress>> {
  if (isIP(hostname)) {
    return [{ address: hostname, family: isIP(hostname) as 4 | 6 }];
  }

  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    return addresses.map(({ address, family }) => ({ address, family }));
  } catch {
    throw new Error('Workbook file host could not be resolved');
  }
}

async function requestWorkbookFile({
  url,
  address,
  maxBytes,
  timeoutMs,
  signal,
}: {
  url: URL;
  address: ResolvedAddress;
  maxBytes: number;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<DownloadResponse> {
  const httpsAgent = new HttpsAgent({
    lookup: (_hostname, _options, callback) => {
      callback(null, address.address, address.family);
    },
  });

  try {
    const response = await axios.get<ArrayBuffer>(url.toString(), {
      responseType: 'arraybuffer',
      maxRedirects: 0,
      maxContentLength: maxBytes,
      maxBodyLength: maxBytes,
      timeout: timeoutMs,
      signal,
      httpsAgent,
      validateStatus: () => true,
      headers: {
        Accept: 'application/octet-stream, application/xml, text/xml, */*',
      },
    });

    return {
      status: response.status,
      location: getStringResponseHeader(response.headers, 'location') || undefined,
      data: Buffer.from(response.data),
    };
  } catch {
    throw new Error('Workbook file download failed');
  } finally {
    httpsAgent.destroy();
  }
}

function parseDownloadUrl(value: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new Error('Workbook file download URL is invalid');
  }
}

function assertAllowedDownloadUrl(url: URL): void {
  const isSafe = isSSRFSafeURL(url.toString(), {
    allowedProtocols: ['https'],
    autoPrependProtocol: false,
  });

  if (
    !isSafe ||
    url.protocol !== 'https:' ||
    Boolean(url.username) ||
    Boolean(url.password) ||
    (url.port !== '' && url.port !== '443')
  ) {
    throw new Error('Workbook file download URL is not allowed');
  }
}

function requirePublicAddress(addresses: ReadonlyArray<ResolvedAddress>): ResolvedAddress {
  if (addresses.length === 0) {
    throw new Error('Workbook file host could not be resolved');
  }

  for (const address of addresses) {
    const host = address.family === 6 ? `[${address.address}]` : address.address;
    if (
      !isSSRFSafeURL(`https://${host}/`, {
        allowedProtocols: ['https'],
        autoPrependProtocol: false,
      })
    ) {
      throw new Error('Workbook file download URL resolved to a disallowed network address');
    }
  }

  return addresses[0];
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function isTwbXml(bytes: Buffer): boolean {
  const xml = bytes.toString('utf8').replace(/^\uFEFF/, '');
  if (/<!DOCTYPE/i.test(xml)) return false;

  let invalid = false;
  try {
    const document = new DOMParser({
      errorHandler: (level) => {
        if (level === 'error' || level === 'fatalError') invalid = true;
      },
    }).parseFromString(xml, 'text/xml');

    return !invalid && document.documentElement?.tagName === 'workbook';
  } catch {
    return false;
  }
}

function sanitizeFileName(fileName: string | undefined): string | undefined {
  if (!fileName) return undefined;

  const baseName = fileName.replace(/\\/g, '/').split('/').pop();
  const sanitized = baseName
    ?.replace(/[^A-Za-z0-9._ -]/g, '_')
    .slice(0, 255)
    .trim();
  return sanitized || undefined;
}

function sanitizeMimeType(mimeType: string | undefined): string | undefined {
  if (!mimeType) return undefined;
  const sanitized = mimeType.replace(/[^A-Za-z0-9!#$&^_.+/-]/g, '').slice(0, 255);
  return sanitized || undefined;
}
