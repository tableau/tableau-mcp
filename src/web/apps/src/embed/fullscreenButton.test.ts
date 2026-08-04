/**
 * @vitest-environment jsdom
 */
import type { App } from '@modelcontextprotocol/ext-apps';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../shared/recordEventClient.js');

import { recordEvent } from '../shared/recordEventClient.js';
import { setupFullscreenButton } from './fullscreenButton.js';

describe('setupFullscreenButton', () => {
  let mockApp: App;
  let container: HTMLElement;
  let hostContext: { displayMode?: string; availableDisplayModes?: string[] };
  const contextListeners: Array<() => void> = [];

  beforeEach(() => {
    container = document.createElement('main');
    container.className = 'main';
    // Add viz container to simulate the real DOM structure
    const vizContainer = document.createElement('div');
    vizContainer.className = 'viz-container';
    container.appendChild(vizContainer);
    // Add controls bar
    const controlsBar = document.createElement('div');
    controlsBar.id = 'vizControlsBar';
    controlsBar.className = 'viz-controls';
    container.appendChild(controlsBar);
    document.body.appendChild(container);

    hostContext = { displayMode: 'inline', availableDisplayModes: ['inline', 'fullscreen'] };
    contextListeners.length = 0;

    mockApp = {
      getHostContext: vi.fn(() => hostContext),
      requestDisplayMode: vi.fn(({ mode }: { mode: string }) => Promise.resolve({ mode })),
      addEventListener: vi.fn((event: string, handler: () => void) => {
        if (event === 'hostcontextchanged') contextListeners.push(handler);
      }),
      removeEventListener: vi.fn((event: string, handler: () => void) => {
        if (event === 'hostcontextchanged') {
          const i = contextListeners.indexOf(handler);
          if (i >= 0) contextListeners.splice(i, 1);
        }
      }),
    } as unknown as App;

    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
  });

  const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

  it('renders the button when host supports the fullscreen display mode', () => {
    setupFullscreenButton(mockApp, container);

    const button = container.querySelector('#fullscreenButton') as HTMLButtonElement;
    expect(button).not.toBeNull();
    expect(button.type).toBe('button');
    expect(button.className).toBe('viz-control-action');
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.getAttribute('aria-label')).toBe('Enter fullscreen');

    // Verify icon + label structure
    const icon = button.querySelector('svg.viz-control-icon');
    const label = button.querySelector('span');
    expect(icon).not.toBeNull();
    expect(label).not.toBeNull();
    expect(label?.textContent).toBe('Fullscreen');
  });

  it('places button in the controls bar after the viz container', () => {
    setupFullscreenButton(mockApp, container);

    const button = container.querySelector('#fullscreenButton') as HTMLButtonElement;
    const vizContainer = container.querySelector('.viz-container') as HTMLElement;
    const controlsBar = container.querySelector('#vizControlsBar') as HTMLElement;

    expect(button).not.toBeNull();
    expect(vizContainer).not.toBeNull();
    expect(controlsBar).not.toBeNull();

    // Button should be inside the controls bar
    expect(controlsBar.contains(button)).toBe(true);

    // Controls bar should come after viz container in DOM order
    const controlsIndex = Array.from(container.children).indexOf(controlsBar);
    const vizIndex = Array.from(container.children).indexOf(vizContainer);
    expect(controlsIndex).toBeGreaterThan(vizIndex);
  });

  it('does not render when fullscreen is not an available display mode', () => {
    hostContext.availableDisplayModes = ['inline'];
    setupFullscreenButton(mockApp, container);
    expect(container.querySelector('#fullscreenButton')).toBeNull();
  });

  it('does not render when host context is undefined', () => {
    mockApp.getHostContext = vi.fn(() => undefined);
    setupFullscreenButton(mockApp, container);
    expect(container.querySelector('#fullscreenButton')).toBeNull();
  });

  it('click requests fullscreen and updates label/aria-pressed from the result', async () => {
    setupFullscreenButton(mockApp, container);
    const button = container.querySelector('#fullscreenButton') as HTMLButtonElement;

    button.click();
    await flush();

    expect(mockApp.requestDisplayMode).toHaveBeenCalledWith({ mode: 'fullscreen' });
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.getAttribute('aria-label')).toBe('Exit fullscreen');

    // Verify label span text updated (icon remains)
    const label = button.querySelector('span');
    expect(label?.textContent).toBe('Exit fullscreen');
    const icon = button.querySelector('svg.viz-control-icon');
    expect(icon).not.toBeNull();
  });

  it('click while fullscreen requests inline', async () => {
    hostContext.displayMode = 'fullscreen';
    setupFullscreenButton(mockApp, container);
    const button = container.querySelector('#fullscreenButton') as HTMLButtonElement;

    button.click();
    await flush();

    expect(mockApp.requestDisplayMode).toHaveBeenCalledWith({ mode: 'inline' });
  });

  it('reflects host refusal: keeps inline state when the result stays inline', async () => {
    // Host refuses fullscreen and keeps inline.
    mockApp.requestDisplayMode = vi.fn(() => Promise.resolve({ mode: 'inline' as const }));
    setupFullscreenButton(mockApp, container);
    const button = container.querySelector('#fullscreenButton') as HTMLButtonElement;

    button.click();
    await flush();

    expect(button.getAttribute('aria-pressed')).toBe('false');
    const label = button.querySelector('span');
    expect(label?.textContent).toBe('Fullscreen');
  });

  it('records MCP_APP_CLICKED telemetry on click', async () => {
    setupFullscreenButton(mockApp, container);
    const button = container.querySelector('#fullscreenButton') as HTMLButtonElement;

    button.click();
    await flush();

    expect(vi.mocked(recordEvent)).toHaveBeenCalledWith(mockApp, 'MCP_APP_CLICKED', 'fullscreen');
  });

  it('re-syncs the button when hostcontextchanged fires', () => {
    setupFullscreenButton(mockApp, container);
    const button = container.querySelector('#fullscreenButton') as HTMLButtonElement;
    expect(button.getAttribute('aria-pressed')).toBe('false');

    // Host switches to fullscreen on its own.
    hostContext.displayMode = 'fullscreen';
    contextListeners.forEach((h) => h());

    expect(button.getAttribute('aria-pressed')).toBe('true');
    const label = button.querySelector('span');
    expect(label?.textContent).toBe('Exit fullscreen');
  });

  it('Escape exits fullscreen when in fullscreen mode', async () => {
    hostContext.displayMode = 'fullscreen';
    setupFullscreenButton(mockApp, container);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flush();

    expect(mockApp.requestDisplayMode).toHaveBeenCalledWith({ mode: 'inline' });
  });

  it('is idempotent: calling twice yields one button and one Escape handler', async () => {
    hostContext.displayMode = 'fullscreen';
    setupFullscreenButton(mockApp, container);
    setupFullscreenButton(mockApp, container);

    // Exactly one button and one host-context listener remain.
    expect(container.querySelectorAll('#fullscreenButton').length).toBe(1);
    expect(contextListeners.length).toBe(1);

    // Only one Escape handler is active -> requestDisplayMode called exactly once.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flush();
    expect(mockApp.requestDisplayMode).toHaveBeenCalledTimes(1);
  });

  it('toggles correctly across multiple clicks without host pushing hostcontextchanged', async () => {
    // This test reproduces the real bug: getHostContext().displayMode is NOT updated
    // when requestDisplayMode() resolves (faithful to the SDK). The button must NOT
    // rely on getHostContext() for the toggle decision or it will compute the wrong target.
    setupFullscreenButton(mockApp, container);
    const button = container.querySelector('#fullscreenButton') as HTMLButtonElement;
    const getLabel = (): string | null | undefined => button.querySelector('span')?.textContent;

    // Initial state: inline mode
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(getLabel()).toBe('Fullscreen');

    // Click 1: Enter fullscreen
    button.click();
    await flush();
    expect(mockApp.requestDisplayMode).toHaveBeenCalledWith({ mode: 'fullscreen' });
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(getLabel()).toBe('Exit fullscreen');

    // hostContext.displayMode is STILL 'inline' (SDK doesn't update it on requestDisplayMode resolution)
    expect(hostContext.displayMode).toBe('inline');

    // Click 2: Exit fullscreen (this is where the bug manifests - should request 'inline', not 'fullscreen' again)
    button.click();
    await flush();
    expect(mockApp.requestDisplayMode).toHaveBeenCalledWith({ mode: 'inline' });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(getLabel()).toBe('Fullscreen');

    // Click 3: Enter fullscreen again (toggle keeps working)
    button.click();
    await flush();
    expect(mockApp.requestDisplayMode).toHaveBeenCalledWith({ mode: 'fullscreen' });
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(getLabel()).toBe('Exit fullscreen');
  });
});
