import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { writeFileSync } from 'fs';
import { Ok } from 'ts-results-es';

import * as episodeEvents from '../../../desktop/episode-events.js';
import { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import {
  MockExternalApiServer,
  startMockExternalApiServer,
} from '../../../desktop/externalApi/mockExternalApiServer.js';
import { ExternalApiInstance } from '../../../desktop/externalApi/types.js';
import * as sessionResolution from '../../../desktop/session/sessionResolution.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { exportSheetImageTool } from './exportSheetImage.js';

vi.mock('../../../desktop/session/sessionResolution.js');
// Only writeFileSync is stubbed — the cap-downgrade path must not touch disk. existsSync /
// mkdirSync stay real so DesktopCache constructs against the real cache dir.
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return { ...actual, writeFileSync: vi.fn() };
});

describe('export-sheet-image', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  it('returns a worksheet image inline as a base64 PNG block from one call by id', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ sheetId: 'sheet-sales', kind: 'worksheet' });

      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'image');
      expect(result.content[0].mimeType).toBe('image/png');
      expect(result.content[0].data.length).toBeGreaterThan(0);
      expect(harness.server.requests.map((request) => request.path)).toEqual([
        '/v0/workbook/worksheets/sheet-sales/image',
      ]);
      // No mimeType arg → no mimeType query param forwarded (Desktop defaults to image/png).
      expect(harness.server.requests.at(-1)?.searchParams.mimeType).toBeUndefined();
    } finally {
      await harness.close();
    }
  });

  it('falls back to the worksheet list when sheetId is a name', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ sheetId: 'Sales by Region', kind: 'worksheet' });

      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'image');
      expect(harness.server.requests.map((request) => request.path)).toEqual([
        '/v0/workbook/worksheets/Sales%20by%20Region/image',
        '/v0/workbook/worksheets',
        '/v0/workbook/worksheets/sheet-sales/image',
      ]);
    } finally {
      await harness.close();
    }
  });

  it('returns a dashboard image inline as a base64 PNG block from one call by id', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ sheetId: 'dash-exec', kind: 'dashboard' });

      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'image');
      expect(result.content[0].mimeType).toBe('image/png');
      expect(harness.server.requests.map((request) => request.path)).toEqual([
        '/v0/workbook/dashboards/dash-exec/image',
      ]);
    } finally {
      await harness.close();
    }
  });

  it('returns a storyboard image inline as a base64 PNG block from one call by id', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ sheetId: 'story-qbr', kind: 'storyboard' });

      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'image');
      expect(result.content[0].mimeType).toBe('image/png');
      expect(harness.server.requests.map((request) => request.path)).toEqual([
        '/v0/workbook/storyboards/story-qbr/image',
      ]);
    } finally {
      await harness.close();
    }
  });

  it('refuses a storyboard export before API 0.2.7 and still exports a worksheet', async () => {
    const harness = await startHarness(undefined, undefined, '0.2.6');
    try {
      const storyboard = await harness.callTool({ sheetId: 'story-qbr', kind: 'storyboard' });
      expect(storyboard.isError).toBe(true);
      invariant(storyboard.content[0].type === 'text');
      expect(storyboard.content[0].text).toContain('does not serve the storyboard image endpoint');
      expect(harness.server.requests).toEqual([]);

      const worksheet = await harness.callTool({ sheetId: 'sheet-sales', kind: 'worksheet' });
      expect(worksheet.isError).toBe(false);
      expect(harness.server.requests.map((request) => request.path)).toEqual([
        '/v0/workbook/worksheets/sheet-sales/image',
      ]);
    } finally {
      await harness.close();
    }
  });

  it('forwards mimeType and returns an SVG as both a text and an image block', async () => {
    const svgBase64 = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64');
    const harness = await startHarness((server) => {
      server.setOverride('GET /v0/workbook/worksheets/sheet-sales/image', {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          imageBase64: svgBase64,
          width: 640,
          height: 480,
          effectiveMimeType: 'image/svg+xml',
        }),
      });
    });
    try {
      const result = await harness.callTool({
        sheetId: 'sheet-sales',
        kind: 'worksheet',
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
    const harness = await startHarness();
    try {
      const result = await harness.callTool({
        sheetId: 'sheet-sales',
        kind: 'worksheet',
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

  it.each([
    {
      args: { sheetId: 'sheet-sales', kind: 'worksheet' },
      path: '/v0/workbook/worksheets/sheet-sales/image',
    },
    {
      args: { sheetId: 'dash-exec', kind: 'dashboard' },
      path: '/v0/workbook/dashboards/dash-exec/image',
    },
  ])('reports no pixel size for an SVG written to $path', async ({ args, path }) => {
    const harness = await startHarness((server) => {
      server.setOverride(`GET ${path}`, {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          filePath: '/tmp/out.svg',
          width: -1,
          height: -1,
          effectiveMimeType: 'image/svg+xml',
        }),
      });
    });
    try {
      const result = await harness.callTool({
        ...args,
        filePath: '/tmp/out.svg',
        mimeType: 'image/svg+xml',
      });

      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('/tmp/out.svg');
      expect(result.content[0].text).toContain('pixel size not applicable');
      expect(result.content[0].text).not.toContain('-1');
    } finally {
      await harness.close();
    }
  });

  it('downgrades an over-cap inline image to a cache file instead of an image block', async () => {
    const harness = await startHarness(undefined, {
      inlineImageMaxBytes: 1,
    });
    try {
      const result = await harness.callTool({ sheetId: 'sheet-sales', kind: 'worksheet' });

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
    const harness = await startHarness(undefined, {
      inlineImageMaxBytes: 69,
    });
    try {
      const result = await harness.callTool({ sheetId: 'sheet-sales', kind: 'worksheet' });

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
      (server) => {
        server.setOverride('GET /v0/workbook/worksheets/sheet-sales/image', {
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            imageBase64: svgBase64,
            width: 640,
            height: 480,
            effectiveMimeType: 'image/svg+xml',
          }),
        });
      },
      { inlineImageMaxBytes: cap },
    );
    try {
      const result = await harness.callTool({
        sheetId: 'sheet-sales',
        kind: 'worksheet',
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
    const eventSpy = vi.spyOn(episodeEvents, 'emitEpisodeEvent');
    const errorSpy = vi.spyOn(episodeEvents, 'emitToolErrorEvent');
    const harness = await startHarness((server) => {
      server.setOverride('GET /v0/workbook/worksheets/sheet-sales/image', {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ width: 640, height: 480 }),
      });
    });
    try {
      const result = await harness.callTool({ sheetId: 'sheet-sales', kind: 'worksheet' });

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('neither image bytes nor a file path');
      expect(vi.mocked(writeFileSync)).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          tool: 'export-sheet-image',
          error: 'Tool returned an error result.',
        }),
      );
      expect(eventSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          type: 'tool_end',
          tool: 'export-sheet-image',
          success: false,
          outcome: 'failed',
        }),
      );
    } finally {
      errorSpy.mockRestore();
      eventSpy.mockRestore();
      await harness.close();
    }
  });

  it('labels from effectiveMimeType, not the bytes: SVG-looking bytes declared image/png render a single PNG block', async () => {
    // No byte-sniff fallback: the server-declared effectiveMimeType is authoritative. Even when
    // the bytes look like SVG, a `image/png` declaration yields a single image/png block with no
    // SVG text block — proving the label follows the field, not the content.
    const svgBase64 = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64');
    const harness = await startHarness((server) => {
      server.setOverride('GET /v0/workbook/worksheets/sheet-sales/image', {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          imageBase64: svgBase64,
          width: 640,
          height: 480,
          effectiveMimeType: 'image/png',
        }),
      });
    });
    try {
      const result = await harness.callTool({
        sheetId: 'sheet-sales',
        kind: 'worksheet',
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

  it('normalizes effectiveMimeType (mixed case + trailing whitespace) to svg and dual-emits', async () => {
    const svgBase64 = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64');
    const harness = await startHarness((server) => {
      server.setOverride('GET /v0/workbook/worksheets/sheet-sales/image', {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          imageBase64: svgBase64,
          width: 640,
          height: 480,
          effectiveMimeType: 'IMAGE/SVG+XML ',
        }),
      });
    });
    try {
      const result = await harness.callTool({
        sheetId: 'sheet-sales',
        kind: 'worksheet',
        mimeType: 'image/svg+xml',
      });

      expect(result.isError).toBe(false);
      expect(result.content).toHaveLength(2);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('<svg');
      invariant(result.content[1].type === 'image');
      expect(result.content[1].mimeType).toBe('image/svg+xml');
    } finally {
      await harness.close();
    }
  });

  it('defaults to a single image/png block when effectiveMimeType is absent (accepted no-fallback default)', async () => {
    // Older Desktop builds that predate the effectiveMimeType field omit it. With no byte-sniff
    // fallback, SVG-looking bytes and no declaration are labelled image/png — the documented
    // degradation on such builds.
    const svgBase64 = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64');
    const harness = await startHarness((server) => {
      server.setOverride('GET /v0/workbook/worksheets/sheet-sales/image', {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ imageBase64: svgBase64, width: 640, height: 480 }),
      });
    });
    try {
      const result = await harness.callTool({
        sheetId: 'sheet-sales',
        kind: 'worksheet',
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
      (server) => {
        server.setOverride('GET /v0/workbook/worksheets/sheet-sales/image', {
          status: 200,
          hang: true,
        });
      },
      { imageExportTimeoutMs: 1 },
    );
    try {
      const result = await harness.callTool({ sheetId: 'sheet-sales', kind: 'worksheet' });

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('image export exceeded');
      expect(result.content[0].text).toContain('Do not blindly retry the originating operation');
      expect(result.content[0].text).toContain('get-active-dialogs');
      expect(result.content[0].text).toContain('exact returned dialog identity');
      expect(result.content[0].text).toContain('advertised action');
      expect(result.content[0].text).toContain('invoke-dialog-action for one logical action');
      expect(result.content[0].text).toContain(
        'replay only the identical request with the same requestId',
      );
      expect(result.content[0].text).toContain('Do not guess or assume Cancel is safe');
      expect(result.content[0].text).toContain('ask the user to handle the dialog');
    } finally {
      await harness.close();
    }
  });

  it('surfaces the Problem code alongside the detail when the image endpoint returns a 500', async () => {
    const harness = await startHarness((server) => {
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
      const result = await harness.callTool({ sheetId: 'sheet-sales', kind: 'worksheet' });

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('Render failed');
      expect(result.content[0].text).toContain('0x8F2A4D91');
    } finally {
      await harness.close();
    }
  });

  it('surfaces a 409 viz-not-ready as a command error (not a too-new endpoint)', async () => {
    const harness = await startHarness((server) => {
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
      const result = await harness.callTool({ sheetId: 'sheet-sales', kind: 'worksheet' });

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('not ready to render');
      // A 409 is a live-endpoint condition, NOT the too-new-endpoint signal.
      expect(result.content[0].text).not.toContain('Do not retry');
    } finally {
      await harness.close();
    }
  });

  it('reports available worksheets when neither the id nor a name matches', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ sheetId: 'Missing Sheet', kind: 'worksheet' });

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('Worksheet "Missing Sheet" was not found.');
      expect(harness.server.requests.map((request) => request.path)).toEqual([
        '/v0/workbook/worksheets/Missing%20Sheet/image',
        '/v0/workbook/worksheets',
      ]);
    } finally {
      await harness.close();
    }
  });

  it.each([
    {
      args: { sheetId: 'sheet-sales', kind: 'worksheet' },
      overrideKey: 'GET /v0/workbook/worksheets/sheet-sales/image',
      expectedMessage: 'does not serve the worksheet image endpoint',
    },
    {
      args: { sheetId: 'dash-exec', kind: 'dashboard' },
      overrideKey: 'GET /v0/workbook/dashboards/dash-exec/image',
      expectedMessage: 'does not serve the dashboard image endpoint',
    },
    {
      args: { sheetId: 'story-qbr', kind: 'storyboard' },
      overrideKey: 'GET /v0/workbook/storyboards/story-qbr/image',
      expectedMessage: 'does not serve the storyboard image endpoint',
    },
  ])(
    'reports an honest too-new endpoint 404 for $expectedMessage',
    async ({ args, overrideKey, expectedMessage }) => {
      const harness = await startHarness((server) => {
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

  it.each([
    {
      label: 'a relative worksheet filePath',
      args: { sheetId: 'sheet-sales', kind: 'worksheet', filePath: 'relative/report.png' },
      imagePath: '/v0/workbook/worksheets/sheet-sales/image',
    },
    {
      label: 'a ..-bearing worksheet filePath',
      args: { sheetId: 'sheet-sales', kind: 'worksheet', filePath: '/tmp/../etc/report.png' },
      imagePath: '/v0/workbook/worksheets/sheet-sales/image',
    },
    {
      label: 'a relative dashboard filePath',
      args: { sheetId: 'dash-exec', kind: 'dashboard', filePath: 'relative/dash.png' },
      imagePath: '/v0/workbook/dashboards/dash-exec/image',
    },
    {
      label: 'a relative storyboard filePath',
      args: { sheetId: 'story-qbr', kind: 'storyboard', filePath: 'relative/story.png' },
      imagePath: '/v0/workbook/storyboards/story-qbr/image',
    },
  ])(
    'forwards the raw path and surfaces the Desktop 400 for $label (no client-side refine)',
    async ({ args, imagePath }) => {
      // The tool boundary passes filePath through raw — Desktop is the authoritative path
      // boundary (a client-side refine would have to duplicate OS-specific absolute-path
      // semantics and risk rejecting valid Windows/UNC paths). This pins that the raw path
      // reaches the image endpoint and the resulting 400 (code + detail) surfaces to the model.
      const harness = await startHarness();
      try {
        const result = await harness.callTool(args);

        expect(result.isError).toBe(true);
        invariant(result.content[0].type === 'text');
        expect(result.content[0].text).toContain('Invalid filePath');
        expect(result.content[0].text).toContain('invalid-query-parameter');
        const lastRequest = harness.server.requests.at(-1);
        expect(lastRequest?.path).toBe(imagePath);
        expect(lastRequest?.searchParams.filePath).toBe(args.filePath);
        expect(vi.mocked(writeFileSync)).not.toHaveBeenCalled();
      } finally {
        await harness.close();
      }
    },
  );
});

async function startHarness(
  configure?: (server: MockExternalApiServer) => void,
  configPatch?: Partial<ReturnType<typeof getMockRequestHandlerExtra>['config']>,
  apiVersion = '1.0',
): Promise<{
  server: MockExternalApiServer;
  callTool: (args: Record<string, unknown>) => Promise<CallToolResult>;
  close: () => Promise<void>;
}> {
  const server = await startMockExternalApiServer();
  configure?.(server);
  const executor = new ExternalApiToolExecutor({
    discover: () => [instanceFor(server, apiVersion)],
  });
  await executor.start();
  const tool = exportSheetImageTool(new DesktopMcpServer());
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

function instanceFor(server: MockExternalApiServer, apiVersion: string): ExternalApiInstance {
  return {
    baseUrl: server.baseUrl,
    token: 'valid-token',
    pid: 999,
    instanceId: 'inst-export-image-tools',
    apiVersion,
  };
}
