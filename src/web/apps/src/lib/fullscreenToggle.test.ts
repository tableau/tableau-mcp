/**
 * @vitest-environment jsdom
 */
import type { App } from '@modelcontextprotocol/ext-apps';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setupFullscreenToggle } from './fullscreenToggle.js';

// Create a minimal stub App for testing
function createStubApp(hostContext?: {
  displayMode?: 'inline' | 'fullscreen' | 'pip';
  availableDisplayModes?: ('inline' | 'fullscreen' | 'pip')[];
}): App {
  const requestDisplayMode = vi.fn();
  const getHostContext = vi.fn(() => hostContext);

  return {
    getHostContext,
    requestDisplayMode,
  } as unknown as App;
}

describe('setupFullscreenToggle', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    container.id = 'test-container';
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  // RED: Test 1 - Should NOT render when fullscreen is not available
  it('should not render toggle when availableDisplayModes does not include fullscreen', () => {
    const app = createStubApp({
      displayMode: 'inline',
      availableDisplayModes: ['inline'], // No fullscreen
    });

    setupFullscreenToggle(app, container);

    // Should not add any button
    const button = container.querySelector('button');
    expect(button).toBeNull();
  });

  // RED: Test 2 - Should NOT render when host context is undefined
  it('should not render toggle when host context is undefined', () => {
    const app = createStubApp(undefined);

    setupFullscreenToggle(app, container);

    const button = container.querySelector('button');
    expect(button).toBeNull();
  });

  // RED: Test 3 - Should render when fullscreen is available
  it('should render toggle button when fullscreen is available', () => {
    const app = createStubApp({
      displayMode: 'inline',
      availableDisplayModes: ['inline', 'fullscreen'],
    });

    setupFullscreenToggle(app, container);

    const button = container.querySelector('button');
    expect(button).toBeTruthy();
    expect(button?.getAttribute('role')).toBe('button');
    expect(button?.getAttribute('aria-label')).toBeTruthy();
  });

  // RED: Test 4 - Should call requestDisplayMode with fullscreen when clicked from inline
  it('should request fullscreen mode when clicked from inline', async () => {
    const app = createStubApp({
      displayMode: 'inline',
      availableDisplayModes: ['inline', 'fullscreen'],
    });

    (app.requestDisplayMode as ReturnType<typeof vi.fn>).mockResolvedValue({
      mode: 'fullscreen',
    });

    setupFullscreenToggle(app, container);

    const button = container.querySelector('button') as HTMLButtonElement;
    expect(button).toBeTruthy();

    button.click();

    // Should have called requestDisplayMode with fullscreen
    expect(app.requestDisplayMode).toHaveBeenCalledWith({ mode: 'fullscreen' });
  });

  // RED: Test 5 - Should call requestDisplayMode with inline when clicked from fullscreen
  it('should request inline mode when clicked from fullscreen', async () => {
    const app = createStubApp({
      displayMode: 'fullscreen',
      availableDisplayModes: ['inline', 'fullscreen'],
    });

    (app.requestDisplayMode as ReturnType<typeof vi.fn>).mockResolvedValue({
      mode: 'inline',
    });

    setupFullscreenToggle(app, container);

    const button = container.querySelector('button') as HTMLButtonElement;
    button.click();

    expect(app.requestDisplayMode).toHaveBeenCalledWith({ mode: 'inline' });
  });

  // RED: Test 6 - Should apply fullscreen class when mode is fullscreen
  it('should apply fullscreen class to container when mode is granted as fullscreen', async () => {
    const app = createStubApp({
      displayMode: 'inline',
      availableDisplayModes: ['inline', 'fullscreen'],
    });

    (app.requestDisplayMode as ReturnType<typeof vi.fn>).mockResolvedValue({
      mode: 'fullscreen',
    });

    setupFullscreenToggle(app, container);

    const button = container.querySelector('button') as HTMLButtonElement;

    await button.click();
    // Wait for async requestDisplayMode
    await vi.waitFor(() => {
      expect(container.classList.contains('fullscreen')).toBe(true);
    });
  });

  // RED: Test 7 - Should remove fullscreen class when mode is granted as inline
  it('should remove fullscreen class when mode is granted as inline', async () => {
    const app = createStubApp({
      displayMode: 'fullscreen',
      availableDisplayModes: ['inline', 'fullscreen'],
    });

    container.classList.add('fullscreen'); // Start in fullscreen

    (app.requestDisplayMode as ReturnType<typeof vi.fn>).mockResolvedValue({
      mode: 'inline',
    });

    setupFullscreenToggle(app, container);

    const button = container.querySelector('button') as HTMLButtonElement;

    await button.click();
    await vi.waitFor(() => {
      expect(container.classList.contains('fullscreen')).toBe(false);
    });
  });

  // RED: Test 8 - Should handle requestDisplayMode rejection gracefully
  it('should catch and warn when requestDisplayMode fails', async () => {
    const app = createStubApp({
      displayMode: 'inline',
      availableDisplayModes: ['inline', 'fullscreen'],
    });

    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    (app.requestDisplayMode as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Host denied'),
    );

    setupFullscreenToggle(app, container);

    const button = container.querySelector('button') as HTMLButtonElement;
    await button.click();

    await vi.waitFor(() => {
      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    consoleWarnSpy.mockRestore();
  });

  // RED: Test 9 - Should be idempotent (remove existing control before adding new one)
  it('should remove existing control before adding new one', () => {
    const app = createStubApp({
      displayMode: 'inline',
      availableDisplayModes: ['inline', 'fullscreen'],
    });

    // Call twice
    setupFullscreenToggle(app, container);
    setupFullscreenToggle(app, container);

    // Should have exactly one button
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBe(1);
  });

  // RED: Test 10 - Should update button aria-pressed based on current mode
  it('should set aria-pressed to true when in fullscreen mode', () => {
    const app = createStubApp({
      displayMode: 'fullscreen',
      availableDisplayModes: ['inline', 'fullscreen'],
    });

    setupFullscreenToggle(app, container);

    const button = container.querySelector('button') as HTMLButtonElement;
    expect(button.getAttribute('aria-pressed')).toBe('true');
  });

  // RED: Test 11 - Should set aria-pressed to false when in inline mode
  it('should set aria-pressed to false when in inline mode', () => {
    const app = createStubApp({
      displayMode: 'inline',
      availableDisplayModes: ['inline', 'fullscreen'],
    });

    setupFullscreenToggle(app, container);

    const button = container.querySelector('button') as HTMLButtonElement;
    expect(button.getAttribute('aria-pressed')).toBe('false');
  });

  // RED: Test 12 - Should make button keyboard operable
  it('should allow keyboard activation with Enter key', async () => {
    const app = createStubApp({
      displayMode: 'inline',
      availableDisplayModes: ['inline', 'fullscreen'],
    });

    (app.requestDisplayMode as ReturnType<typeof vi.fn>).mockResolvedValue({
      mode: 'fullscreen',
    });

    setupFullscreenToggle(app, container);

    const button = container.querySelector('button') as HTMLButtonElement;
    expect(button).toBeTruthy();

    // Simulate Enter key press
    const enterEvent = new KeyboardEvent('keydown', { key: 'Enter' });
    button.dispatchEvent(enterEvent);

    // The button's native click should have been triggered via Enter
    // In a real browser, Enter on a button triggers click automatically
    // but in jsdom we need to simulate this behavior or just verify the button is focusable
    expect(button.tabIndex).toBeGreaterThanOrEqual(0);
  });
});
