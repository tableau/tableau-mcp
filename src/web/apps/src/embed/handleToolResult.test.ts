/**
 * @vitest-environment jsdom
 */
import type { App } from '@modelcontextprotocol/ext-apps';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { handleToolResult } from './handleToolResult.js';

// Mock dependencies
vi.mock('./getEmbedTokenToolClient.js');
vi.mock('./embedTableauViz.js');
vi.mock('./loadTableauEmbeddingApi.js');
vi.mock('./openInTableauLink.js');
vi.mock('./fullscreenButton.js');
vi.mock('../shared/recordEventClient.js');

import { recordEvent } from '../shared/recordEventClient.js';
import { embedTableauViz } from './embedTableauViz.js';
import { setupFullscreenButton } from './fullscreenButton.js';
import { callGetEmbedTokenTool } from './getEmbedTokenToolClient.js';
import { loadTableauEmbeddingApi } from './loadTableauEmbeddingApi.js';
import { setupOpenInTableauLink } from './openInTableauLink.js';

describe('handleToolResult', () => {
  let mockApp: App;

  beforeEach(() => {
    // Set up DOM (simulating the real app structure with viz-container)
    const main = document.createElement('div');
    main.className = 'main';
    const vizContainer = document.createElement('div');
    vizContainer.className = 'viz-container';
    vizContainer.id = 'tableauVizContainer';
    main.appendChild(vizContainer);
    // Add controls bar
    const controlsBar = document.createElement('div');
    controlsBar.id = 'vizControlsBar';
    controlsBar.className = 'viz-controls';
    main.appendChild(controlsBar);
    document.body.appendChild(main);

    // Create mock app
    mockApp = {
      getHostCapabilities: vi.fn().mockReturnValue({ serverTools: {} }),
      callServerTool: vi.fn(),
    } as unknown as App;

    // Mute console.error output during tests
    vi.spyOn(console, 'error').mockImplementation(() => {});

    // Default mock: embedding API loads successfully for most tests
    vi.mocked(loadTableauEmbeddingApi).mockResolvedValue(undefined);
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('should show error UI when tool returns error result (isError: true)', async () => {
    const errorResult: CallToolResult = {
      isError: true,
      content: [
        {
          type: 'text',
          text: 'Tool execution failed',
        },
      ],
    };

    await handleToolResult(mockApp, errorResult);

    // Flush async
    await new Promise((r) => setTimeout(r, 0));

    const container = document.getElementById('tableauVizContainer');

    // NO tableau-viz rendered
    expect(container?.querySelector('tableau-viz')).toBeNull();

    // error UI IS displayed
    const errorElement = container?.querySelector('.mcp-app-error');
    expect(errorElement).toBeTruthy();

    // New two-line layout: heading + subtitle
    expect(errorElement?.querySelector('.mcp-app-error-heading')?.textContent).toBe(
      'Unable to load this Tableau view',
    );
    expect(errorElement?.querySelector('.mcp-app-error-message')?.textContent).toBe(
      'The tool request was unsuccessful.',
    );

    // Assert embedTableauViz was NOT called
    expect(vi.mocked(embedTableauViz)).not.toHaveBeenCalled();
  });

  it('should show error UI when tool result is null or undefined', async () => {
    // Test with undefined
    await handleToolResult(mockApp, undefined as any);
    await new Promise((r) => setTimeout(r, 0));

    const container = document.getElementById('tableauVizContainer');

    // NO tableau-viz rendered
    expect(container?.querySelector('tableau-viz')).toBeNull();

    // error UI IS displayed
    const errorElement = container?.querySelector('.mcp-app-error');
    expect(errorElement).toBeTruthy();

    // New two-line layout: heading + subtitle
    expect(errorElement?.querySelector('.mcp-app-error-heading')?.textContent).toBe(
      'Unable to load this Tableau view',
    );
    expect(errorElement?.querySelector('.mcp-app-error-message')?.textContent).toBe(
      'The tool request was unsuccessful.',
    );

    // Assert embedTableauViz was NOT called
    expect(vi.mocked(embedTableauViz)).not.toHaveBeenCalled();

    // Clean up for null test
    vi.mocked(embedTableauViz).mockClear();

    // Test with null
    await handleToolResult(mockApp, null as any);
    await new Promise((r) => setTimeout(r, 0));

    const errorElement2 = container?.querySelector('.mcp-app-error');
    expect(container?.querySelector('tableau-viz')).toBeNull();
    expect(errorElement2).toBeTruthy();
    expect(errorElement2?.querySelector('.mcp-app-error-heading')?.textContent).toBe(
      'Unable to load this Tableau view',
    );
    expect(errorElement2?.querySelector('.mcp-app-error-message')?.textContent).toBe(
      'The tool request was unsuccessful.',
    );
    expect(vi.mocked(embedTableauViz)).not.toHaveBeenCalled();
  });

  it('should show error UI when tool result is malformed JSON', async () => {
    const malformedResult: CallToolResult = {
      content: [
        {
          type: 'text',
          text: 'not json',
        },
      ],
    };

    await handleToolResult(mockApp, malformedResult);
    await new Promise((r) => setTimeout(r, 0));

    const container = document.getElementById('tableauVizContainer');

    // NO tableau-viz rendered
    expect(container?.querySelector('tableau-viz')).toBeNull();

    // error UI IS displayed
    const errorElement = container?.querySelector('.mcp-app-error');
    expect(errorElement).toBeTruthy();

    // New two-line layout: heading + subtitle
    expect(errorElement?.querySelector('.mcp-app-error-heading')?.textContent).toBe(
      'Unable to load this Tableau view',
    );
    expect(errorElement?.querySelector('.mcp-app-error-message')?.textContent).toBe(
      'The response was not in the expected format.',
    );

    // Assert embedTableauViz was NOT called
    expect(vi.mocked(embedTableauViz)).not.toHaveBeenCalled();
  });

  it('should show error UI when tool result has valid JSON but missing url field', async () => {
    const missingUrlResult: CallToolResult = {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ notUrl: 'something else' }),
        },
      ],
    };

    await handleToolResult(mockApp, missingUrlResult);
    await new Promise((r) => setTimeout(r, 0));

    const container = document.getElementById('tableauVizContainer');

    // Assert NO tableau-viz rendered
    expect(container?.querySelector('tableau-viz')).toBeNull();

    // Assert error UI IS displayed
    expect(container?.querySelector('.mcp-app-error')).toBeTruthy();
  });

  it('should show error UI when embedding API script fails to load', async () => {
    const validResult: CallToolResult = {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            url: 'https://prod-uswest-c.online.tableau.com/site/mysite/views/workbook/view',
          }),
        },
      ],
    };

    vi.mocked(loadTableauEmbeddingApi).mockRejectedValue(new Error('Script load failed'));

    await handleToolResult(mockApp, validResult);
    await new Promise((r) => setTimeout(r, 0));

    const container = document.getElementById('tableauVizContainer');

    // NO tableau-viz rendered
    expect(container?.querySelector('tableau-viz')).toBeNull();

    // error UI IS displayed
    const errorElement = container?.querySelector('.mcp-app-error');
    expect(errorElement).toBeTruthy();

    // New two-line layout: heading + subtitle
    expect(errorElement?.querySelector('.mcp-app-error-heading')?.textContent).toBe(
      'Unable to load this Tableau view',
    );
    expect(errorElement?.querySelector('.mcp-app-error-message')?.textContent).toBe(
      'The visualization failed to load.',
    );

    // Assert downstream functions were NOT called
    expect(vi.mocked(callGetEmbedTokenTool)).not.toHaveBeenCalled();
    expect(vi.mocked(embedTableauViz)).not.toHaveBeenCalled();
  });

  it('should show error UI when token minting fails', async () => {
    const validResult: CallToolResult = {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            url: 'https://prod-uswest-c.online.tableau.com/site/mysite/views/workbook/view',
          }),
        },
      ],
    };

    vi.mocked(callGetEmbedTokenTool).mockRejectedValue(new Error('Token minting failed'));

    await handleToolResult(mockApp, validResult);
    await new Promise((r) => setTimeout(r, 0));

    const container = document.getElementById('tableauVizContainer');

    // NO tableau-viz rendered
    expect(container?.querySelector('tableau-viz')).toBeNull();

    // error UI IS displayed
    const errorElement = container?.querySelector('.mcp-app-error');
    expect(errorElement).toBeTruthy();

    // New two-line layout: heading + subtitle
    expect(errorElement?.querySelector('.mcp-app-error-heading')?.textContent).toBe(
      'Unable to load this Tableau view',
    );
    expect(errorElement?.querySelector('.mcp-app-error-message')?.textContent).toBe(
      'Authentication was unsuccessful.',
    );

    // Assert embedTableauViz was NOT called
    expect(vi.mocked(embedTableauViz)).not.toHaveBeenCalled();
  });

  it('runtime: replaces viz with error UI when vizloaderror fires after embedding', async () => {
    const validResult: CallToolResult = {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            url: 'https://prod-uswest-c.online.tableau.com/site/mysite/views/workbook/view',
          }),
        },
      ],
    };

    vi.mocked(callGetEmbedTokenTool).mockResolvedValue('test-token');

    // Override embedTableauViz to simulate runtime viz load error
    vi.mocked(embedTableauViz).mockImplementation((_url, _token, onError) => {
      const container = document.getElementById('tableauVizContainer');
      const viz = document.createElement('tableau-viz');
      container?.replaceChildren(viz);
      // Simulate runtime vizloaderror event
      onError?.();
    });

    await handleToolResult(mockApp, validResult);
    await new Promise((r) => setTimeout(r, 0));

    const container = document.getElementById('tableauVizContainer');

    // viz was replaced (removed)
    expect(container?.querySelector('tableau-viz')).toBeNull();

    // error UI IS displayed
    const errorElement = container?.querySelector('.mcp-app-error');
    expect(errorElement).toBeTruthy();

    // New two-line layout: heading + subtitle
    expect(errorElement?.querySelector('.mcp-app-error-heading')?.textContent).toBe(
      'Unable to load this Tableau view',
    );
    expect(errorElement?.querySelector('.mcp-app-error-message')?.textContent).toBe(
      'Authentication was unsuccessful.',
    );
  });

  it('happy path: should successfully embed viz when all operations succeed', async () => {
    const validResult: CallToolResult = {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            url: 'https://prod-uswest-c.online.tableau.com/site/mysite/views/workbook/view',
          }),
        },
      ],
    };

    vi.mocked(callGetEmbedTokenTool).mockResolvedValue('test-token-123');
    vi.mocked(embedTableauViz).mockImplementation(() => {});
    vi.mocked(setupFullscreenButton).mockImplementation(() => {});
    vi.mocked(setupOpenInTableauLink).mockImplementation(() => {});

    await handleToolResult(mockApp, validResult);
    await new Promise((r) => setTimeout(r, 0));

    const container = document.getElementById('tableauVizContainer');

    // Assert NO error UI displayed
    expect(container?.querySelector('.mcp-app-error')).toBeNull();

    // Assert embedTableauViz WAS called once
    expect(vi.mocked(embedTableauViz)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(embedTableauViz)).toHaveBeenCalledWith(
      'https://prod-uswest-c.online.tableau.com/site/mysite/views/workbook/view',
      'test-token-123',
      expect.any(Function),
    );

    // Assert setupOpenInTableauLink WAS called first (left of button in top controls row)
    expect(vi.mocked(setupOpenInTableauLink)).toHaveBeenCalledTimes(1);

    // Assert setupFullscreenButton WAS called second (right of link in top controls row)
    expect(vi.mocked(setupFullscreenButton)).toHaveBeenCalledTimes(1);

    // Verify order: link setup called before button setup (left-to-right in controls row)
    const linkCallOrder = vi.mocked(setupOpenInTableauLink).mock.invocationCallOrder[0];
    const buttonCallOrder = vi.mocked(setupFullscreenButton).mock.invocationCallOrder[0];
    expect(linkCallOrder).toBeLessThan(buttonCallOrder);
  });

  it('no-ops on an empty (dataless) delivery instead of showing PARSE_ERROR', async () => {
    // The host can re-fire ui/notifications/tool-result on a re-render/re-mount with a
    // protocol-legal but empty result (content: [], no structuredContent). There is nothing to
    // embed, so this must be a silent no-op — NOT a PARSE_ERROR.
    const emptyResult: CallToolResult = {
      content: [],
    };

    await handleToolResult(mockApp, emptyResult);
    await new Promise((r) => setTimeout(r, 0));

    const container = document.getElementById('tableauVizContainer');

    // NO error UI displayed
    expect(container?.querySelector('.mcp-app-error')).toBeNull();

    // No embedding attempted and no telemetry event recorded
    expect(vi.mocked(embedTableauViz)).not.toHaveBeenCalled();
    expect(vi.mocked(recordEvent)).not.toHaveBeenCalled();
  });

  it('does not overwrite an existing render when an empty re-delivery arrives', async () => {
    // First delivery: happy path renders a viz.
    const validResult: CallToolResult = {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            url: 'https://prod-uswest-c.online.tableau.com/site/mysite/views/workbook/view',
          }),
        },
      ],
    };

    vi.mocked(callGetEmbedTokenTool).mockResolvedValue('test-token-123');
    vi.mocked(embedTableauViz).mockImplementation((_url, _token) => {
      const container = document.getElementById('tableauVizContainer');
      container?.replaceChildren(document.createElement('tableau-viz'));
    });
    vi.mocked(setupOpenInTableauLink).mockImplementation(() => {});

    await handleToolResult(mockApp, validResult);
    await new Promise((r) => setTimeout(r, 0));

    const container = document.getElementById('tableauVizContainer');
    expect(container?.querySelector('tableau-viz')).toBeTruthy();

    // Second delivery: empty re-fire. Must leave the rendered viz intact and show no error.
    await handleToolResult(mockApp, { content: [] });
    await new Promise((r) => setTimeout(r, 0));

    expect(container?.querySelector('tableau-viz')).toBeTruthy();
    expect(container?.querySelector('.mcp-app-error')).toBeNull();
  });

  it('reports telemetry with the tool error message when a tool error occurs', async () => {
    const errorResult: CallToolResult = {
      isError: true,
      content: [{ type: 'text', text: 'Tool execution failed' }],
    };

    await handleToolResult(mockApp, errorResult);
    await new Promise((r) => setTimeout(r, 0));

    expect(vi.mocked(recordEvent)).toHaveBeenCalledWith(
      mockApp,
      'TOOL_ERROR',
      'Tool execution failed',
    );
  });

  it('reports telemetry with undefined cause when the tool result is null', async () => {
    await handleToolResult(mockApp, null as any);
    await new Promise((r) => setTimeout(r, 0));

    expect(vi.mocked(recordEvent)).toHaveBeenCalledWith(mockApp, 'TOOL_ERROR', undefined);
  });
});
