/**
 * @vitest-environment jsdom
 */
import type { App } from '@modelcontextprotocol/ext-apps';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./recordMcpAppErrorClient.js');
import { reportMcpAppError } from './recordMcpAppErrorClient.js';
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

    // Silence the expected console.error output from the error paths these tests exercise.
    // Nothing asserts on console; this only keeps test output clean.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    // Clean up DOM
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('should display TOOL_ERROR scenario with user-facing message', () => {
    showError('TOOL_ERROR');

    const container = document.getElementById('tableauVizContainer');
    const errorElement = container?.querySelector('.mcp-app-error');
    const headingElement = errorElement?.querySelector('.mcp-app-error-heading');
    const messageElement = errorElement?.querySelector('.mcp-app-error-message');

    // tableau-viz removed, error UI displayed
    expect(container?.querySelector('tableau-viz')).toBeNull();
    expect(errorElement).toBeTruthy();

    // New two-line layout: heading + subtitle
    expect(headingElement?.textContent).toBe('Unable to load this Tableau view');
    expect(messageElement?.textContent).toBe('The tool request was unsuccessful.');

    expect(errorElement?.getAttribute('role')).toBe('alert');
    expect(errorElement?.querySelector('.mcp-app-error-icon')).toBeTruthy();
  });

  it('should display PARSE_ERROR scenario with user-facing message', () => {
    const cause = new Error('JSON parse failed');

    showError('PARSE_ERROR', cause);

    const container = document.getElementById('tableauVizContainer');
    const errorElement = container?.querySelector('.mcp-app-error');
    const headingElement = errorElement?.querySelector('.mcp-app-error-heading');
    const messageElement = errorElement?.querySelector('.mcp-app-error-message');

    // tableau-viz removed, error UI displayed
    expect(container?.querySelector('tableau-viz')).toBeNull();
    expect(errorElement).toBeTruthy();

    // New two-line layout: heading + subtitle
    expect(headingElement?.textContent).toBe('Unable to load this Tableau view');
    expect(messageElement?.textContent).toBe('The response was not in the expected format.');

    expect(errorElement?.querySelector('.mcp-app-error-icon')).toBeTruthy();
  });

  it('should display AUTH_ERROR scenario with user-facing message', () => {
    showError('AUTH_ERROR');

    const container = document.getElementById('tableauVizContainer');
    const errorElement = container?.querySelector('.mcp-app-error');
    const headingElement = errorElement?.querySelector('.mcp-app-error-heading');
    const messageElement = errorElement?.querySelector('.mcp-app-error-message');

    // tableau-viz removed, error UI displayed
    expect(container?.querySelector('tableau-viz')).toBeNull();
    expect(errorElement).toBeTruthy();

    // New two-line layout: heading + subtitle
    expect(headingElement?.textContent).toBe('Unable to load this Tableau view');
    expect(messageElement?.textContent).toBe('Authentication was unsuccessful.');

    expect(errorElement?.querySelector('.mcp-app-error-icon')).toBeTruthy();
  });

  it('should display EMBED_LOAD_ERROR scenario with user-facing message', () => {
    showError('EMBED_LOAD_ERROR');

    const container = document.getElementById('tableauVizContainer');
    const errorElement = container?.querySelector('.mcp-app-error');
    const headingElement = errorElement?.querySelector('.mcp-app-error-heading');
    const messageElement = errorElement?.querySelector('.mcp-app-error-message');

    // tableau-viz removed, error UI displayed
    expect(container?.querySelector('tableau-viz')).toBeNull();
    expect(errorElement).toBeTruthy();

    // New two-line layout: heading + subtitle
    expect(headingElement?.textContent).toBe('Unable to load this Tableau view');
    expect(messageElement?.textContent).toBe('The visualization failed to load.');

    expect(errorElement?.querySelector('.mcp-app-error-icon')).toBeTruthy();
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

    // Should not throw
    showError('TOOL_ERROR');

    expect(document.querySelector('.mcp-app-error')).toBeNull();
  });

  it('reports telemetry with scenario and cause when app is provided', () => {
    const app = {} as unknown as App;
    const cause = new Error('JSON parse failed');

    showError('PARSE_ERROR', cause, app);

    expect(vi.mocked(reportMcpAppError)).toHaveBeenCalledWith(app, 'PARSE_ERROR', cause);
  });

  it('does not report telemetry when app is not provided', () => {
    showError('TOOL_ERROR');

    expect(vi.mocked(reportMcpAppError)).not.toHaveBeenCalled();
  });

  it('reports telemetry even when the container is missing', () => {
    document.body.replaceChildren();
    const app = {} as unknown as App;

    showError('EMBED_LOAD_ERROR', undefined, app);

    expect(vi.mocked(reportMcpAppError)).toHaveBeenCalledWith(app, 'EMBED_LOAD_ERROR', undefined);
    expect(document.querySelector('.mcp-app-error')).toBeNull();
  });
});
