/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { showError } from './showError.js';

describe('showError', () => {
  beforeEach(() => {
    // Set up DOM with tableauVizContainer
    const main = document.createElement('div');
    main.className = 'main';
    const container = document.createElement('div');
    container.id = 'tableauVizContainer';
    main.appendChild(container);
    document.body.appendChild(main);
  });

  afterEach(() => {
    // Clean up DOM
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('should display TOOL_ERROR scenario with user-facing message', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    showError('TOOL_ERROR');

    const container = document.getElementById('tableauVizContainer');
    const errorElement = container?.querySelector('.mcp-app-error');
    const headingElement = errorElement?.querySelector('.mcp-app-error-heading');
    const messageElement = errorElement?.querySelector('.mcp-app-error-message');

    // AC6 invariants: tableau-viz removed, error UI displayed
    expect(container?.querySelector('tableau-viz')).toBeNull();
    expect(errorElement).toBeTruthy();

    // New two-line layout: heading + subtitle
    expect(headingElement?.textContent).toBe('Unable to load this Tableau view');
    expect(messageElement?.textContent).toBe('The tool request was unsuccessful.');

    expect(errorElement?.getAttribute('role')).toBe('alert');
    expect(errorElement?.querySelector('.mcp-app-error-icon')).toBeTruthy();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[mcp-app:tool-error] Tool returned an error result',
      undefined,
    );
  });

  it('should display PARSE_ERROR scenario with user-facing message', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cause = new Error('JSON parse failed');

    showError('PARSE_ERROR', cause);

    const container = document.getElementById('tableauVizContainer');
    const errorElement = container?.querySelector('.mcp-app-error');
    const headingElement = errorElement?.querySelector('.mcp-app-error-heading');
    const messageElement = errorElement?.querySelector('.mcp-app-error-message');

    // AC6 invariants: tableau-viz removed, error UI displayed
    expect(container?.querySelector('tableau-viz')).toBeNull();
    expect(errorElement).toBeTruthy();

    // New two-line layout: heading + subtitle
    expect(headingElement?.textContent).toBe('Unable to load this Tableau view');
    expect(messageElement?.textContent).toBe('The response was not in the expected format.');

    expect(errorElement?.querySelector('.mcp-app-error-icon')).toBeTruthy();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[mcp-app:parse-error] Failed to parse tool result',
      cause,
    );
  });

  it('should display AUTH_ERROR scenario with user-facing message', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    showError('AUTH_ERROR');

    const container = document.getElementById('tableauVizContainer');
    const errorElement = container?.querySelector('.mcp-app-error');
    const headingElement = errorElement?.querySelector('.mcp-app-error-heading');
    const messageElement = errorElement?.querySelector('.mcp-app-error-message');

    // AC6 invariants: tableau-viz removed, error UI displayed
    expect(container?.querySelector('tableau-viz')).toBeNull();
    expect(errorElement).toBeTruthy();

    // New two-line layout: heading + subtitle
    expect(headingElement?.textContent).toBe('Unable to load this Tableau view');
    expect(messageElement?.textContent).toBe('Authentication was unsuccessful.');

    expect(errorElement?.querySelector('.mcp-app-error-icon')).toBeTruthy();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[mcp-app:auth-error] Failed to obtain or use embed token',
      undefined,
    );
  });

  it('should display EMBED_LOAD_ERROR scenario with user-facing message', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    showError('EMBED_LOAD_ERROR');

    const container = document.getElementById('tableauVizContainer');
    const errorElement = container?.querySelector('.mcp-app-error');
    const headingElement = errorElement?.querySelector('.mcp-app-error-heading');
    const messageElement = errorElement?.querySelector('.mcp-app-error-message');

    // AC6 invariants: tableau-viz removed, error UI displayed
    expect(container?.querySelector('tableau-viz')).toBeNull();
    expect(errorElement).toBeTruthy();

    // New two-line layout: heading + subtitle
    expect(headingElement?.textContent).toBe('Unable to load this Tableau view');
    expect(messageElement?.textContent).toBe('The visualization failed to load.');

    expect(errorElement?.querySelector('.mcp-app-error-icon')).toBeTruthy();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[mcp-app:embed-load-error] Tableau Embedding API failed to load',
      undefined,
    );
  });

  it('should remove any existing tableau-viz element when showing error', () => {
    const container = document.getElementById('tableauVizContainer');
    const viz = document.createElement('tableau-viz');
    viz.setAttribute('src', 'https://test.com/view');
    container?.appendChild(viz);

    showError('TOOL_ERROR');

    expect(container?.querySelector('tableau-viz')).toBeNull();
    expect(container?.querySelector('.mcp-app-error')).toBeTruthy();
  });

  it('should do nothing if container is missing', () => {
    document.body.replaceChildren();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Should not throw
    showError('TOOL_ERROR');

    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });
});
