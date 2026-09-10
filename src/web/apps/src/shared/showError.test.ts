/**
 * @vitest-environment jsdom
 */
import type { App } from '@modelcontextprotocol/ext-apps';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock only recordEvent (telemetry side effect); keep the real toMessage so
// showError's cause-rendering logic (which imports toMessage from this module)
// is exercised as written.
vi.mock('./recordEventClient.js', async (importOriginal) => ({
  ...(await importOriginal()),
  recordEvent: vi.fn(),
}));
import { recordEvent } from './recordEventClient.js';
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

  it('should display PARSE_ERROR scenario with user-facing message and cause line', () => {
    const cause = new Error('JSON parse failed');

    showError('PARSE_ERROR', cause);

    const container = document.getElementById('tableauVizContainer');
    const errorElement = container?.querySelector('.mcp-app-error');
    const headingElement = errorElement?.querySelector('.mcp-app-error-heading');
    const messageElement = errorElement?.querySelector('.mcp-app-error-message');
    const causeElement = errorElement?.querySelector('.mcp-app-error-cause');

    // tableau-viz removed, error UI displayed
    expect(container?.querySelector('tableau-viz')).toBeNull();
    expect(errorElement).toBeTruthy();

    // New two-line layout: heading + subtitle
    expect(headingElement?.textContent).toBe('Unable to load this Tableau view');
    expect(messageElement?.textContent).toBe('The response was not in the expected format.');

    // Cause (an Error) renders as a secondary line using its message
    expect(causeElement?.textContent).toBe('JSON parse failed');

    expect(errorElement?.querySelector('.mcp-app-error-icon')).toBeTruthy();
  });

  it('should display the cause as a secondary line when cause is a plain string', () => {
    showError('AUTH_ERROR', 'token expired at 12:00');

    const container = document.getElementById('tableauVizContainer');
    const errorElement = container?.querySelector('.mcp-app-error');
    const causeElement = errorElement?.querySelector('.mcp-app-error-cause');

    expect(causeElement?.textContent).toBe('token expired at 12:00');
  });

  it('should not display a cause line when cause is undefined', () => {
    showError('AUTH_ERROR');

    const container = document.getElementById('tableauVizContainer');
    const errorElement = container?.querySelector('.mcp-app-error');

    expect(errorElement?.querySelector('.mcp-app-error-cause')).toBeNull();
  });

  it('should not display a cause line when cause is an empty or whitespace-only string', () => {
    showError('AUTH_ERROR', '   ');

    const container = document.getElementById('tableauVizContainer');
    const errorElement = container?.querySelector('.mcp-app-error');

    expect(errorElement?.querySelector('.mcp-app-error-cause')).toBeNull();
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

  it('reports telemetry with scenario and cause as the detail arg when app is provided', () => {
    const app = {} as unknown as App;
    const cause = new Error('JSON parse failed');

    showError('PARSE_ERROR', cause, app);

    // cause is passed as the event detail, which populates the telemetry message field.
    expect(vi.mocked(recordEvent)).toHaveBeenCalledWith(app, 'PARSE_ERROR', cause);
  });

  it('does not report telemetry when app is not provided', () => {
    showError('TOOL_ERROR');

    expect(vi.mocked(recordEvent)).not.toHaveBeenCalled();
  });

  it('reports telemetry even when the container is missing', () => {
    document.body.replaceChildren();
    const app = {} as unknown as App;

    showError('EMBED_LOAD_ERROR', undefined, app);

    expect(vi.mocked(recordEvent)).toHaveBeenCalledWith(app, 'EMBED_LOAD_ERROR', undefined);
    expect(document.querySelector('.mcp-app-error')).toBeNull();
  });
});
