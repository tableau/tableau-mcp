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
    // Add viz stage wrapper
    const vizStage = document.createElement('div');
    vizStage.id = 'vizStage';
    vizStage.className = 'viz-stage';
    // Add viz container inside the stage
    const vizContainer = document.createElement('div');
    vizContainer.id = 'tableauVizContainer';
    vizContainer.className = 'viz-container';
    vizStage.appendChild(vizContainer);
    container.appendChild(vizStage);
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

  // The shared floating overlay pill. In fullscreen the WHOLE pill is hidden
  // (both controls), so visibility assertions target the pill, not the button.
  const overlayGroup = (): HTMLElement =>
    container.querySelector('#vizOverlayGroup') as HTMLElement;

  it('renders the button as an overlay-control inside the overlay pill', () => {
    setupFullscreenButton(mockApp, container);

    const button = container.querySelector('#fullscreenButton') as HTMLButtonElement;
    expect(button).not.toBeNull();
    expect(button.type).toBe('button');
    expect(button.className).toBe('overlay-control');
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.getAttribute('aria-label')).toBe('Enter fullscreen');

    // Inline mode: no `.fullscreen` class, so the CSS inline height cap
    // (`.main:not(.fullscreen) tableau-viz`) applies.
    expect(container.classList.contains('fullscreen')).toBe(false);

    // The pill exists and is visible in inline mode.
    expect(overlayGroup()).not.toBeNull();
    expect(overlayGroup().contains(button)).toBe(true);
    expect(overlayGroup().hidden).toBe(false);

    // Verify icon + label structure
    const icon = button.querySelector('svg.viz-control-icon');
    const label = button.querySelector('span');
    expect(icon).not.toBeNull();
    expect(label).not.toBeNull();
    expect(label?.textContent).toBe('Fullscreen');
  });

  it('places the pill floating over viz inside viz-stage wrapper and survives viz re-embed', () => {
    setupFullscreenButton(mockApp, container);

    const button = container.querySelector('#fullscreenButton') as HTMLButtonElement;
    const vizStage = container.querySelector('#vizStage') as HTMLElement;
    const vizContainer = container.querySelector('#tableauVizContainer') as HTMLElement;
    const group = container.querySelector('#vizOverlayGroup') as HTMLElement;

    expect(button).not.toBeNull();
    expect(vizStage).not.toBeNull();
    expect(vizContainer).not.toBeNull();
    expect(group).not.toBeNull();

    // Button lives in the overlay pill; the pill is a direct child of viz-stage
    // (sibling of viz-container, NOT inside it).
    expect(group.contains(button)).toBe(true);
    expect(vizContainer.contains(button)).toBe(false);
    expect(Array.from(vizStage.children)).toContain(group);
    expect(Array.from(vizStage.children)).toContain(vizContainer);

    // Survival test: Simulate embedTableauViz's replaceChildren behavior on the viz-container.
    // This is the CRITICAL risk: embedTableauViz calls container.replaceChildren(viz), which
    // destroys all children of #tableauVizContainer. The overlay pill MUST survive because
    // it lives in the parent #vizStage wrapper (NOT inside #tableauVizContainer).
    // This test FAILS if someone later moves the pill into the viz-container.
    const newViz = document.createElement('tableau-viz');
    vizContainer.replaceChildren(newViz);

    // Button should STILL exist after re-embed (it's in the pill under vizStage, not vizContainer)
    const buttonAfterEmbed = container.querySelector('#fullscreenButton') as HTMLButtonElement;
    expect(buttonAfterEmbed).toBe(button); // Same button instance
    expect(vizStage.contains(buttonAfterEmbed)).toBe(true);
    expect(vizContainer.contains(buttonAfterEmbed)).toBe(false);

    // Verify the new viz is now in the container, but the pill survived
    expect(vizContainer.contains(newViz)).toBe(true);
    expect(Array.from(vizStage.children)).toContain(group);
    expect(group.contains(buttonAfterEmbed)).toBe(true);
    expect(Array.from(vizStage.children)).toContain(vizContainer);
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

  it('click requests fullscreen and hides the pill', async () => {
    setupFullscreenButton(mockApp, container);
    const button = container.querySelector('#fullscreenButton') as HTMLButtonElement;

    expect(overlayGroup().hidden).toBe(false); // Initially visible (inline mode)

    button.click();
    await flush();

    expect(mockApp.requestDisplayMode).toHaveBeenCalledWith({ mode: 'fullscreen' });
    expect(overlayGroup().hidden).toBe(true); // Pill hidden in fullscreen mode
    expect(button.getAttribute('aria-pressed')).toBe('true');

    // Fullscreen: `.fullscreen` class added, so the inline height cap is dropped
    // and the viz uses its natural height.
    expect(container.classList.contains('fullscreen')).toBe(true);

    // Icon still exists (button structure intact, just hidden with the pill)
    const icon = button.querySelector('svg.viz-control-icon');
    expect(icon).not.toBeNull();
  });

  it('click while fullscreen requests inline and shows the pill', async () => {
    hostContext.displayMode = 'fullscreen';
    setupFullscreenButton(mockApp, container);
    const button = container.querySelector('#fullscreenButton') as HTMLButtonElement;

    expect(overlayGroup().hidden).toBe(true); // Initially hidden (fullscreen mode)
    expect(container.classList.contains('fullscreen')).toBe(true); // Cap dropped in fullscreen

    button.click();
    await flush();

    expect(mockApp.requestDisplayMode).toHaveBeenCalledWith({ mode: 'inline' });
    expect(overlayGroup().hidden).toBe(false); // Visible again in inline mode
    expect(container.classList.contains('fullscreen')).toBe(false); // Inline cap reinstated
  });

  it('reflects host refusal: keeps inline state when the result stays inline', async () => {
    // Host refuses fullscreen and keeps inline.
    mockApp.requestDisplayMode = vi.fn(() => Promise.resolve({ mode: 'inline' as const }));
    setupFullscreenButton(mockApp, container);
    const button = container.querySelector('#fullscreenButton') as HTMLButtonElement;

    button.click();
    await flush();

    expect(overlayGroup().hidden).toBe(false); // Pill still visible (inline mode)
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

  it('re-syncs the pill when hostcontextchanged fires (host-initiated mode change)', () => {
    setupFullscreenButton(mockApp, container);
    const button = container.querySelector('#fullscreenButton') as HTMLButtonElement;
    expect(overlayGroup().hidden).toBe(false); // Initially visible (inline)
    expect(button.getAttribute('aria-pressed')).toBe('false');

    // Host switches to fullscreen on its own.
    hostContext.displayMode = 'fullscreen';
    contextListeners.forEach((h) => h());

    expect(overlayGroup().hidden).toBe(true); // Pill hidden when host enters fullscreen
    expect(button.getAttribute('aria-pressed')).toBe('true');
    // Host-initiated fullscreen also drops the inline cap.
    expect(container.classList.contains('fullscreen')).toBe(true);
  });

  it('shows the pill again when host exits fullscreen via hostcontextchanged', () => {
    // Start in fullscreen mode
    hostContext.displayMode = 'fullscreen';
    setupFullscreenButton(mockApp, container);
    const button = container.querySelector('#fullscreenButton') as HTMLButtonElement;
    expect(overlayGroup().hidden).toBe(true); // Initially hidden (fullscreen)

    // Host exits fullscreen (e.g., user clicks host chrome exit button)
    hostContext.displayMode = 'inline';
    contextListeners.forEach((h) => h());

    expect(overlayGroup().hidden).toBe(false); // Visible again in inline mode
    expect(button.getAttribute('aria-pressed')).toBe('false');
    const label = button.querySelector('span');
    expect(label?.textContent).toBe('Fullscreen');
  });

  it('Escape exits fullscreen when in fullscreen mode', async () => {
    hostContext.displayMode = 'fullscreen';
    setupFullscreenButton(mockApp, container);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flush();

    expect(mockApp.requestDisplayMode).toHaveBeenCalledWith({ mode: 'inline' });
  });

  it('is idempotent: calling twice yields one button, one pill, and one Escape handler', async () => {
    hostContext.displayMode = 'fullscreen';
    setupFullscreenButton(mockApp, container);
    setupFullscreenButton(mockApp, container);

    // Exactly one button, one pill, and one host-context listener remain.
    expect(container.querySelectorAll('#fullscreenButton').length).toBe(1);
    expect(container.querySelectorAll('#vizOverlayGroup').length).toBe(1);
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

    // Initial state: inline mode (pill visible)
    expect(overlayGroup().hidden).toBe(false);
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(getLabel()).toBe('Fullscreen');

    // Click 1: Enter fullscreen (pill hides)
    button.click();
    await flush();
    expect(mockApp.requestDisplayMode).toHaveBeenCalledWith({ mode: 'fullscreen' });
    expect(overlayGroup().hidden).toBe(true);
    expect(button.getAttribute('aria-pressed')).toBe('true');

    // hostContext.displayMode is STILL 'inline' (SDK doesn't update it on requestDisplayMode resolution)
    expect(hostContext.displayMode).toBe('inline');

    // Click 2: Exit fullscreen (pill shows again - this is where the bug manifests - should request 'inline', not 'fullscreen' again)
    button.click();
    await flush();
    expect(mockApp.requestDisplayMode).toHaveBeenCalledWith({ mode: 'inline' });
    expect(overlayGroup().hidden).toBe(false);
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(getLabel()).toBe('Fullscreen');

    // Click 3: Enter fullscreen again (pill hides - toggle keeps working)
    button.click();
    await flush();
    expect(mockApp.requestDisplayMode).toHaveBeenCalledWith({ mode: 'fullscreen' });
    expect(overlayGroup().hidden).toBe(true);
    expect(button.getAttribute('aria-pressed')).toBe('true');
  });
});
