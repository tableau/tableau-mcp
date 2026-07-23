import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';

import { WebMcpServer } from '../../server.web.js';
import { registerResources } from '../index.js';
import { buildDataAppResourceUri, getBuildDataAppResource } from './buildDataAppResource.js';

function getContentText(content: ReadResourceResult['contents'][number]): string {
  if (!('text' in content)) {
    throw new Error('expected a text resource content, got a blob');
  }
  return content.text;
}

describe('build-data-app resource', () => {
  it('registers at skill://tableau/build-data-app', () => {
    const resource = getBuildDataAppResource(new WebMcpServer());
    expect(resource.uri).toBe('skill://tableau/build-data-app');
    expect(resource.uri).toBe(buildDataAppResourceUri);
  });

  it('returns Markdown', async () => {
    const resource = getBuildDataAppResource(new WebMcpServer());
    expect(resource.mimeType).toBe('text/markdown');

    const result = await resource.read();
    expect(result.contents).toHaveLength(1);
    const [content] = result.contents;
    expect(content.uri).toBe(buildDataAppResourceUri);
    expect(content.mimeType).toBe('text/markdown');

    const text = getContentText(content);
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(0);
  });

  describe('content coverage', () => {
    const getText = async (): Promise<string> => {
      const result = await getBuildDataAppResource(new WebMcpServer()).read();
      const [content] = result.contents;
      return getContentText(content);
    };

    it('describes intent detection', async () => {
      const text = await getText();
      expect(text).toMatch(/intent/i);
      expect(text).toMatch(/chart|visualize|dashboard/i);
    });

    it('tells the model to introspect the datasource, then author the query itself', async () => {
      const text = await getText();
      expect(text).toMatch(/introspect/i);
      // The model authors the query/visualization (it is not seeded by the scaffold).
      expect(text).toMatch(/queryAsync|query-datasource/i);
      expect(text).toMatch(/author/i);
    });

    it('describes authoring app.js in the workspace via upsert', async () => {
      const text = await getText();
      expect(text).toMatch(/workspace/i);
      expect(text).toMatch(/app\.js/i);
      expect(text).toMatch(/upsert-data-app-files/i);
    });

    it('describes rendering safely and reviewing the live app in Tableau after publish', async () => {
      const text = await getText();
      expect(text).toMatch(/render/i);
      // Safe DOM only — never raw HTML with live values.
      expect(text).toMatch(/textContent|createElement/);
      expect(text).toMatch(/review/i);
      expect(text).toMatch(/after publish/i);
    });

    it('describes validation as a precondition to publish', async () => {
      const text = await getText();
      expect(text).toMatch(/validat/i);
    });

    it('requires explicit consent before publishing (never auto-publish)', async () => {
      const text = await getText();
      expect(text).toMatch(/never auto-publish/i);
      expect(text).toMatch(/explicit/i);
    });

    it('preserves and passes the exact validationId for receipt-based publish', async () => {
      const text = await getText();
      expect(text).toMatch(/receipt/i);
      expect(text).toContain('`validationId`');
      expect(text).toMatch(/preserve.{0,30}`validationId`/i);
      expect(text).toMatch(/pass.{0,30}`validationId`/i);
    });

    it('encodes the live-query model and the three learnings; no static-snapshot or Heroku guidance', async () => {
      const text = await getText();
      // Live model, not a static snapshot.
      expect(text).toMatch(/live/i);
      expect(text).toMatch(/readMetadataAsync|queryAsync/);
      expect(text).toMatch(/no embedded data\s+snapshot/i);
      // Learning 1: results are wrapped as { payload: "<json>" }.
      expect(text).toMatch(/payload/i);
      // Learning 2: the datasource must be on the dashboard (zombie worksheet).
      expect(text).toMatch(/zombie/i);
      // No non-extension proxy path, no Heroku hosting guidance.
      expect(text).not.toMatch(/heroku/i);
      expect(text).not.toMatch(/proxy/i);
    });
  });
});

describe('registerResources', () => {
  it('advertises resources as a server capability', () => {
    vi.mocked(McpServer).mockClear();
    new WebMcpServer();

    const [, options] = vi.mocked(McpServer).mock.calls.at(-1) ?? [];
    expect((options as any)?.capabilities?.resources).toBeDefined();
  });

  it('registers skill://tableau/build-data-app exactly once', () => {
    const server = new WebMcpServer();
    server.mcpServer.registerResource = vi.fn();

    registerResources(server, { dataAppWorkspacesEnabled: true });

    const calls = vi
      .mocked(server.mcpServer.registerResource)
      .mock.calls.filter((call) => call[1] === (buildDataAppResourceUri as unknown));
    expect(calls).toHaveLength(1);
  });

  it('registers no data-app resources when passed a disabled gate snapshot', () => {
    const server = new WebMcpServer();
    server.mcpServer.registerResource = vi.fn();

    registerResources(server, { dataAppWorkspacesEnabled: false });

    expect(server.mcpServer.registerResource).not.toHaveBeenCalled();
  });
});
