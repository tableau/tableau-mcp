import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { writeFileSync } from 'fs';
import { Ok } from 'ts-results-es';

import { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import {
  MockExternalApiServer,
  startMockExternalApiServer,
} from '../../../desktop/externalApi/mockExternalApiServer.js';
import { ExternalApiInstance } from '../../../desktop/externalApi/types.js';
import * as sessionResolution from '../../../desktop/sessionResolution.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { DesktopTool } from '../tool.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { exportDashboardImageTool } from './exportDashboardImage.js';
import { exportWorksheetImageTool } from './exportWorksheetImage.js';

vi.mock('../../../desktop/sessionResolution.js');
// Only writeFileSync is stubbed — the cap-downgrade path must not touch disk. existsSync /
// mkdirSync stay real so DesktopCache constructs against the real cache dir.
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return { ...actual, writeFileSync: vi.fn() };
});

describe('export-image tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  it('returns a worksheet image inline as a base64 PNG block after resolving the sheet by id', async () => {
    const harness = await startHarness(exportWorksheetImageTool);
    try {
      const result = await harness.callTool({ worksheet: 'sheet-sales' });

      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'image');
      expect(result.content[0].mimeType).toBe('image/png');
      expect(result.content[0].data.length).toBeGreaterThan(0);
      expect(harness.server.requests.map((request) => request.path)).toEqual([
        '/v0/workbook/worksheets',
        '/v0/workbook/worksheets/sheet-sales/image',
      ]);
      // No mimeType arg → no mimeType query param forwarded (Desktop defaults to image/png).
      expect(harness.server.requests.at(-1)?.searchParams.mimeType).toBeUndefined();
    } finally {
      await harness.close();
    }
  });

  it('resolves a worksheet by name before exporting', async () => {
    const harness = await startHarness(exportWorksheetImageTool);
    try {
      const result = await harness.callTool({ worksheet: 'Sales by Region' });

      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'image');
      expect(harness.server.requests.map((request) => request.path)).toEqual([
        '/v0/workbook/worksheets',
        '/v0/workbook/worksheets/sheet-sales/image',
      ]);
    } finally {
      await harness.close();
    }
  });

  it('returns a dashboard image inline as a base64 PNG block after resolving by name', async () => {
    const harness = await startHarness(exportDashboardImageTool);
    try {
      const result = await harness.callTool({ dashboard: 'Executive Dashboard' });

      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'image');
      expect(result.content[0].mimeType).toBe('image/png');
      expect(harness.server.requests.map((request) => request.path)).toEqual([
        '/v0/workbook/dashboards',
        '/v0/workbook/dashboards/dash-exec/image',
      ]);
    } finally {
      await harness.close();
    }
  });

  it('forwards mimeType and returns an SVG as both a text and an image block', async () => {
    const svgBase64 = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64');
    const harness = await startHarness(exportWorksheetImageTool, (server) => {
      server.setOverride('GET /v0/workbook/worksheets/sheet-sales/image', {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ imageBase64: svgBase64, width: 640, height: 480 }),
      });
    });
    try {
      const result = await harness.callTool({
        worksheet: 'sheet-sales',
        mimeType: 'image/svg+xml',
      });

      expect(result.isError).toBe(false);
      expect(result.content).toHaveLength(2);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('<svg');
      invariant(result.content[1].type === 'image');
      expect(result.content[1].mimeType).toBe('image/svg+xml');
      expect(harness.server.requests.at(-1)?.searchParams.mimeType).toBe('image/svg+xml');
    } finally {
      await harness.close();
    }
  });

  it('projects the server-side file path when filePath is provided (no inline bytes)', async () => {
    const harness = await startHarness(exportWorksheetImageTool);
    try {
      const result = await harness.callTool({
        worksheet: 'sheet-sales',
        filePath: '/tmp/sales.png',
      });

      expect(result.isError).toBe(false);
      expect(result.content).toHaveLength(1);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('/tmp/sales.png');
      expect(harness.server.requests.at(-1)?.searchParams.filePath).toBe('/tmp/sales.png');
    } finally {
      await harness.close();
    }
  });

  it('downgrades an over-cap inline image to a cache file instead of an image block', async () => {
    const harness = await startHarness(exportWorksheetImageTool, undefined, {
      inlineImageMaxBytes: 1,
    });
    try {
      const result = await harness.callTool({ worksheet: 'sheet-sales' });

      expect(result.isError).toBe(false);
      expect(result.content).toHaveLength(1);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('over the 1-byte inline cap');
      expect(result.content[0].text).toMatch(/worksheet-image-.*\.png/);
      expect(vi.mocked(writeFileSync)).toHaveBeenCalledTimes(1);
      const [, data] = vi.mocked(writeFileSync).mock.calls[0];
      expect(Buffer.isBuffer(data)).toBe(true);
    } finally {
      await harness.close();
    }
  });

  it('keeps an inline image whose decoded size is exactly at the cap (inclusive floor)', async () => {
    // SAMPLE_IMAGE_BASE64 decodes to 69 bytes; a cap of exactly 69 must stay inline (`>` cap).
    const harness = await startHarness(exportWorksheetImageTool, undefined, {
      inlineImageMaxBytes: 69,
    });
    try {
      const result = await harness.callTool({ worksheet: 'sheet-sales' });

      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'image');
      expect(vi.mocked(writeFileSync)).not.toHaveBeenCalled();
    } finally {
      await harness.close();
    }
  });

  it('downgrades an SVG whose doubled inline footprint exceeds the cap even though its decoded size does not', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>';
    const svgBase64 = Buffer.from(svg).toString('base64');
    const svgBytes = Buffer.byteLength(svg);
    // Cap sits above the decoded size but below the SVG's doubled text+image footprint.
    const cap = svgBytes + 1;
    const harness = await startHarness(
      exportWorksheetImageTool,
      (server) => {
        server.setOverride('GET /v0/workbook/worksheets/sheet-sales/image', {
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ imageBase64: svgBase64, width: 640, height: 480 }),
        });
      },
      { inlineImageMaxBytes: cap },
    );
    try {
      const result = await harness.callTool({
        worksheet: 'sheet-sales',
        mimeType: 'image/svg+xml',
      });

      expect(result.isError).toBe(false);
      expect(result.content).toHaveLength(1);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain(`over the ${cap}-byte inline cap`);
      // The reported size is the doubled inline footprint, not the decoded size.
      expect(result.content[0].text).toContain(`is ${svgBytes * 2} bytes`);
      expect(result.content[0].text).toMatch(/worksheet-image-.*\.svg/);
      expect(vi.mocked(writeFileSync)).toHaveBeenCalledTimes(1);
    } finally {
      await harness.close();
    }
  });

  it('surfaces a neither-bytes-nor-path envelope as an error (no inline block, no file)', async () => {
    const harness = await startHarness(exportWorksheetImageTool, (server) => {
      server.setOverride('GET /v0/workbook/worksheets/sheet-sales/image', {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ width: 640, height: 480 }),
      });
    });
    try {
      const result = await harness.callTool({ worksheet: 'sheet-sales' });

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('neither image bytes nor a file path');
      expect(vi.mocked(writeFileSync)).not.toHaveBeenCalled();
    } finally {
      await harness.close();
    }
  });

  it('renders a PNG single image block when an SVG was requested but Desktop returned PNG bytes', async () => {
    // Desktop silently falls back to PNG when it declines an SVG render and does not echo the
    // format. The result must sniff the bytes: a single image/png block, no SVG text block.
    const harness = await startHarness(exportWorksheetImageTool, (server) => {
      server.setOverride('GET /v0/workbook/worksheets/sheet-sales/image', {
        status: 200,
        contentType: 'application/json',
        // SAMPLE_IMAGE_BASE64 is a real 1x1 PNG (starts with the PNG magic bytes).
        body: JSON.stringify({
          imageBase64:
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
          width: 640,
          height: 480,
        }),
      });
    });
    try {
      const result = await harness.callTool({
        worksheet: 'sheet-sales',
        mimeType: 'image/svg+xml',
      });

      expect(result.isError).toBe(false);
      expect(result.content).toHaveLength(1);
      invariant(result.content[0].type === 'image');
      expect(result.content[0].mimeType).toBe('image/png');
    } finally {
      await harness.close();
    }
  });

  it('aborts a hung image render at the deadline and reports a timeout (not a cancellation)', async () => {
    const harness = await startHarness(
      exportWorksheetImageTool,
      (server) => {
        server.setOverride('GET /v0/workbook/worksheets/sheet-sales/image', {
          status: 200,
          hang: true,
        });
      },
      { imageExportTimeoutMs: 1 },
    );
    try {
      const result = await harness.callTool({ worksheet: 'sheet-sales' });

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('image export exceeded');
      expect(result.content[0].text).toContain('modal dialog');
      expect(result.content[0].text).toContain('Do not blindly retry');
    } finally {
      await harness.close();
    }
  });

  it('surfaces the Problem code alongside the detail when the image endpoint returns a 500', async () => {
    const harness = await startHarness(exportWorksheetImageTool, (server) => {
      server.setOverride('GET /v0/workbook/worksheets/sheet-sales/image', {
        status: 500,
        body: JSON.stringify({
          type: 'problem',
          code: '0x8F2A4D91',
          status: 500,
          instance: '/v0/mock',
          // A `detail` IS present, so the command-error message is the detail. The code must
          // still be surfaced (via the appended `tableau-error-code` line) rather than dropped.
          detail: 'Render failed',
        }),
      });
    });
    try {
      const result = await harness.callTool({ worksheet: 'sheet-sales' });

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('Render failed');
      expect(result.content[0].text).toContain('0x8F2A4D91');
    } finally {
      await harness.close();
    }
  });

  it('surfaces a 409 viz-not-ready as a command error (not a too-new endpoint)', async () => {
    const harness = await startHarness(exportWorksheetImageTool, (server) => {
      server.setOverride('GET /v0/workbook/worksheets/sheet-sales/image', {
        status: 409,
        body: JSON.stringify({
          type: 'problem',
          code: 'visualization-not-ready',
          status: 409,
          instance: '/v0/mock',
          title: 'The worksheet is not ready to render.',
          detail: 'The worksheet is not ready to render.',
        }),
      });
    });
    try {
      const result = await harness.callTool({ worksheet: 'sheet-sales' });

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('not ready to render');
      // A 409 is a live-endpoint condition, NOT the too-new-endpoint signal.
      expect(result.content[0].text).not.toContain('Do not retry');
    } finally {
      await harness.close();
    }
  });

  it('reports available worksheets when the selector does not resolve (no image call)', async () => {
    const harness = await startHarness(exportWorksheetImageTool);
    try {
      const result = await harness.callTool({ worksheet: 'Missing Sheet' });

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('Worksheet "Missing Sheet" was not found.');
      expect(harness.server.requests.map((request) => request.path)).toEqual([
        '/v0/workbook/worksheets',
      ]);
    } finally {
      await harness.close();
    }
  });

  it.each([
    {
      makeTool: exportWorksheetImageTool,
      args: { worksheet: 'sheet-sales' },
      overrideKey: 'GET /v0/workbook/worksheets/sheet-sales/image',
      expectedMessage: 'does not serve the worksheet image endpoint',
    },
    {
      makeTool: exportDashboardImageTool,
      args: { dashboard: 'dash-exec' },
      overrideKey: 'GET /v0/workbook/dashboards/dash-exec/image',
      expectedMessage: 'does not serve the dashboard image endpoint',
    },
  ])(
    'reports an honest too-new endpoint 404 for $expectedMessage',
    async ({ makeTool, args, overrideKey, expectedMessage }) => {
      const harness = await startHarness(makeTool, (server) => {
        server.setOverride(overrideKey, {
          status: 404,
          body: JSON.stringify({
            code: 'not-found',
            status: 404,
            instance: '/v0/mock',
            title: `No route matches ${overrideKey}`,
            detail: `No route matches ${overrideKey}`,
          }),
        });
      });
      try {
        const result = await harness.callTool(args);

        expect(result.isError).toBe(true);
        invariant(result.content[0].type === 'text');
        expect(result.content[0].text).toContain(expectedMessage);
        expect(result.content[0].text).toContain('Do not retry');
      } finally {
        await harness.close();
      }
    },
  );
});

async function startHarness(
  makeTool: (server: DesktopMcpServer) => DesktopTool<any>,
  configure?: (server: MockExternalApiServer) => void,
  configPatch?: Partial<ReturnType<typeof getMockRequestHandlerExtra>['config']>,
): Promise<{
  server: MockExternalApiServer;
  callTool: (args: Record<string, unknown>) => Promise<CallToolResult>;
  close: () => Promise<void>;
}> {
  const server = await startMockExternalApiServer();
  configure?.(server);
  const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
  await executor.start();
  const tool = makeTool(new DesktopMcpServer());
  const callback = (await Provider.from(tool.callback)) as (
    args: Record<string, unknown>,
    extra: ReturnType<typeof getMockRequestHandlerExtra>,
  ) => Promise<CallToolResult>;
  const base = getMockRequestHandlerExtra();
  const extra = {
    ...base,
    config: { ...base.config, ...configPatch },
    getExecutor: vi.fn().mockResolvedValue(executor),
  };

  return {
    server,
    callTool: async (args) => await callback(args, extra),
    close: async () => {
      executor.stop();
      await server.close();
    },
  };
}

function instanceFor(server: MockExternalApiServer): ExternalApiInstance {
  return {
    baseUrl: server.baseUrl,
    token: 'valid-token',
    pid: 999,
    instanceId: 'inst-export-image-tools',
    apiVersion: '1.0',
  };
}
