/**
 * @vitest-environment jsdom
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { handleToolResult } from './handleToolResult.js';

// Mock dependencies
vi.mock('./getEmbedTokenToolClient.js');
vi.mock('./embedTableauViz.js');
vi.mock('./loadTableauEmbeddingApi.js');
vi.mock('./openInTableauLink.js');

import { embedTableauViz } from './embedTableauViz.js';
import { callGetEmbedTokenTool } from './getEmbedTokenToolClient.js';
import { loadTableauEmbeddingApi } from './loadTableauEmbeddingApi.js';
import { setupOpenInTableauLink } from './openInTableauLink.js';

describe('handleToolResult', () => {
  let mockApp: any;
  let consoleErrorSpy: any;

  beforeEach(() => {
    // Set up DOM
    const main = document.createElement('div');
    main.className = 'main';
    const container = document.createElement('div');
    container.id = 'tableauVizContainer';
    main.appendChild(container);
    document.body.appendChild(main);

    // Create mock app
    mockApp = {
      getHostCapabilities: vi.fn().mockReturnValue({ serverTools: {} }),
      callServerTool: vi.fn(),
    };

    // Spy on console.error
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Default mock: embedding API loads successfully for most tests
    vi.mocked(loadTableauEmbeddingApi).mockResolvedValue(undefined);
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('AC1: should show error UI when tool returns error result (isError: true)', async () => {
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

    // AC6 invariants: NO tableau-viz rendered
    expect(container?.querySelector('tableau-viz')).toBeNull();

    // AC6 invariants: error UI IS displayed
    const errorElement = container?.querySelector('.mcp-app-error');
    expect(errorElement).toBeTruthy();

    // New two-line layout: heading + subtitle
    expect(errorElement?.querySelector('.mcp-app-error-heading')?.textContent).toBe(
      'Unable to load this Tableau view',
    );
    expect(errorElement?.querySelector('.mcp-app-error-message')?.textContent).toBe(
      'The tool request was unsuccessful.',
    );

    // Assert console log identifier
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[mcp-app:tool-error] Tool returned an error result',
      undefined,
    );

    // Assert embedTableauViz was NOT called
    expect(vi.mocked(embedTableauViz)).not.toHaveBeenCalled();
  });

  it('AC1: should show error UI when tool result is null or undefined', async () => {
    // Test with undefined
    await handleToolResult(mockApp, undefined as any);
    await new Promise((r) => setTimeout(r, 0));

    const container = document.getElementById('tableauVizContainer');

    // AC6 invariants: NO tableau-viz rendered
    expect(container?.querySelector('tableau-viz')).toBeNull();

    // AC6 invariants: error UI IS displayed
    const errorElement = container?.querySelector('.mcp-app-error');
    expect(errorElement).toBeTruthy();

    // New two-line layout: heading + subtitle
    expect(errorElement?.querySelector('.mcp-app-error-heading')?.textContent).toBe(
      'Unable to load this Tableau view',
    );
    expect(errorElement?.querySelector('.mcp-app-error-message')?.textContent).toBe(
      'The tool request was unsuccessful.',
    );

    // Assert console log identifier
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[mcp-app:tool-error] Tool returned an error result',
      undefined,
    );

    // Assert embedTableauViz was NOT called
    expect(vi.mocked(embedTableauViz)).not.toHaveBeenCalled();

    // Clean up for null test
    consoleErrorSpy.mockClear();
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
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[mcp-app:tool-error] Tool returned an error result',
      undefined,
    );
    expect(vi.mocked(embedTableauViz)).not.toHaveBeenCalled();
  });

  it('AC2: should show error UI when tool result is malformed JSON', async () => {
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

    // AC6 invariants: NO tableau-viz rendered
    expect(container?.querySelector('tableau-viz')).toBeNull();

    // AC6 invariants: error UI IS displayed
    const errorElement = container?.querySelector('.mcp-app-error');
    expect(errorElement).toBeTruthy();

    // New two-line layout: heading + subtitle
    expect(errorElement?.querySelector('.mcp-app-error-heading')?.textContent).toBe(
      'Unable to load this Tableau view',
    );
    expect(errorElement?.querySelector('.mcp-app-error-message')?.textContent).toBe(
      'The response was not in the expected format.',
    );

    // Assert console log identifier
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[mcp-app:parse-error] Failed to parse tool result',
      expect.any(Error),
    );

    // Assert embedTableauViz was NOT called
    expect(vi.mocked(embedTableauViz)).not.toHaveBeenCalled();
  });

  it('AC2: should show error UI when tool result has valid JSON but missing url field', async () => {
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

    // Assert console log identifier for parse error
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[mcp-app:parse-error] Failed to parse tool result',
      expect.any(Error),
    );
  });

  it('AC4: should show error UI when embedding API script fails to load', async () => {
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

    // AC6 invariants: NO tableau-viz rendered
    expect(container?.querySelector('tableau-viz')).toBeNull();

    // AC6 invariants: error UI IS displayed
    const errorElement = container?.querySelector('.mcp-app-error');
    expect(errorElement).toBeTruthy();

    // New two-line layout: heading + subtitle
    expect(errorElement?.querySelector('.mcp-app-error-heading')?.textContent).toBe(
      'Unable to load this Tableau view',
    );
    expect(errorElement?.querySelector('.mcp-app-error-message')?.textContent).toBe(
      'The visualization failed to load.',
    );

    // Assert console log identifier
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[mcp-app:embed-load-error] Tableau Embedding API failed to load',
      expect.any(Error),
    );

    // Assert downstream functions were NOT called
    expect(vi.mocked(callGetEmbedTokenTool)).not.toHaveBeenCalled();
    expect(vi.mocked(embedTableauViz)).not.toHaveBeenCalled();
  });

  it('AC3: should show error UI when token minting fails', async () => {
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

    // AC6 invariants: NO tableau-viz rendered
    expect(container?.querySelector('tableau-viz')).toBeNull();

    // AC6 invariants: error UI IS displayed
    const errorElement = container?.querySelector('.mcp-app-error');
    expect(errorElement).toBeTruthy();

    // New two-line layout: heading + subtitle
    expect(errorElement?.querySelector('.mcp-app-error-heading')?.textContent).toBe(
      'Unable to load this Tableau view',
    );
    expect(errorElement?.querySelector('.mcp-app-error-message')?.textContent).toBe(
      'Authentication was unsuccessful.',
    );

    // Assert console log identifier
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[mcp-app:auth-error] Failed to obtain or use embed token',
      expect.any(Error),
    );

    // Assert embedTableauViz was NOT called
    expect(vi.mocked(embedTableauViz)).not.toHaveBeenCalled();
  });

  it('AC3 runtime: replaces viz with error UI when vizloaderror fires after embedding', async () => {
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

    // AC6 invariants: viz was replaced (removed)
    expect(container?.querySelector('tableau-viz')).toBeNull();

    // AC6 invariants: error UI IS displayed
    const errorElement = container?.querySelector('.mcp-app-error');
    expect(errorElement).toBeTruthy();

    // New two-line layout: heading + subtitle
    expect(errorElement?.querySelector('.mcp-app-error-heading')?.textContent).toBe(
      'Unable to load this Tableau view',
    );
    expect(errorElement?.querySelector('.mcp-app-error-message')?.textContent).toBe(
      'Authentication was unsuccessful.',
    );

    // Assert console log identifier for auth error
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[mcp-app:auth-error] Failed to obtain or use embed token',
      undefined,
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

    // Assert setupOpenInTableauLink WAS called
    expect(vi.mocked(setupOpenInTableauLink)).toHaveBeenCalledTimes(1);
  });
});
