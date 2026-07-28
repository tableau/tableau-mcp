import { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';

import { WebMcpServer } from '../../server.web.js';
import { registerResources } from '../index.js';
import { designDataAppResourceUri, getDesignDataAppResource } from './designDataAppResource.js';

function getContentText(content: ReadResourceResult['contents'][number]): string {
  if (!('text' in content)) {
    throw new Error('expected a text resource content, got a blob');
  }
  return content.text;
}

describe('design-data-app resource', () => {
  it('registers at skill://tableau/design-data-app', () => {
    const resource = getDesignDataAppResource(new WebMcpServer());
    expect(resource.uri).toBe('skill://tableau/design-data-app');
    expect(resource.uri).toBe(designDataAppResourceUri);
  });

  it('returns Markdown', async () => {
    const resource = getDesignDataAppResource(new WebMcpServer());
    expect(resource.mimeType).toBe('text/markdown');

    const result = await resource.read();
    expect(result.contents).toHaveLength(1);
    const [content] = result.contents;
    expect(content.uri).toBe(designDataAppResourceUri);
    expect(content.mimeType).toBe('text/markdown');

    const text = getContentText(content);
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(0);
  });

  describe('content coverage', () => {
    const getText = async (): Promise<string> => {
      const result = await getDesignDataAppResource(new WebMcpServer()).read();
      const [content] = result.contents;
      return getContentText(content);
    };

    it('leads with message-first structure (BLUF / pyramid / so-what)', async () => {
      const text = await getText();
      expect(text).toMatch(/BLUF/);
      expect(text).toMatch(/pyramid/i);
      expect(text).toMatch(/so what/i);
      expect(text).toMatch(/action.{0,10}title/i);
    });

    it('covers the perception hierarchy and mark choice', async () => {
      const text = await getText();
      expect(text).toMatch(/perception hierarchy/i);
      expect(text).toMatch(/position/i);
      expect(text).toMatch(/bar/i);
    });

    it('covers archetypes by audience', async () => {
      const text = await getText();
      expect(text).toMatch(/strategic/i);
      expect(text).toMatch(/operational/i);
      expect(text).toMatch(/analytical/i);
    });

    it('covers graphical integrity (zero baseline, dual axis, provenance)', async () => {
      const text = await getText();
      expect(text).toMatch(/zero baseline/i);
      expect(text).toMatch(/dual axis/i);
      expect(text).toMatch(/as of/i);
    });

    it('covers accessible color (grey default + one accent, colorblind, contrast)', async () => {
      const text = await getText();
      expect(text).toMatch(/grey|gray/i);
      expect(text).toMatch(/one accent/i);
      expect(text).toMatch(/colorbrewer/i);
      expect(text).toMatch(/color.?vision|colorblind|red-green/i);
      expect(text).toMatch(/contrast|WCAG/);
    });

    it('frames the review as publishing to personal space and reviewing in Tableau (no local preview)', async () => {
      const text = await getText();
      expect(text).toMatch(/cannot/i);
      expect(text).toMatch(/live/i);
      expect(text).toMatch(/personal space/i);
      expect(text).toMatch(/5-second test/i);
    });

    it('is framed as a custom-rendered web app (you draw the marks yourself)', async () => {
      const text = await getText();
      // Custom rendering — the model draws marks itself.
      expect(text).toMatch(/HTML|SVG|Canvas|DOM|CSS/);
      expect(text).toMatch(/render everything yourself|you draw the marks|custom.rendered/i);
    });

    it('cross-links the build skill', async () => {
      const text = await getText();
      expect(text).toContain('skill://tableau/build-data-app');
    });
  });
});

describe('registerResources (design-data-app)', () => {
  it('registers skill://tableau/design-data-app exactly once when enabled', () => {
    const server = new WebMcpServer();
    server.mcpServer.registerResource = vi.fn();

    registerResources(server, { dataAppWorkspacesEnabled: true });

    const calls = vi
      .mocked(server.mcpServer.registerResource)
      .mock.calls.filter((call) => call[1] === (designDataAppResourceUri as unknown));
    expect(calls).toHaveLength(1);
  });

  it('does not register the design skill when the gate is disabled', () => {
    const server = new WebMcpServer();
    server.mcpServer.registerResource = vi.fn();

    registerResources(server, { dataAppWorkspacesEnabled: false });

    const calls = vi
      .mocked(server.mcpServer.registerResource)
      .mock.calls.filter((call) => call[1] === (designDataAppResourceUri as unknown));
    expect(calls).toHaveLength(0);
  });
});
