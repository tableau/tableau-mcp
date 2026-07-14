/**
 * @vitest-environment jsdom
 */
import type { App } from '@modelcontextprotocol/ext-apps';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EXPAND_BUTTON_CLASS, FULLSCREEN_CLASS, setupExpandControl } from './expandControl.js';
import { PREVIEW_WRAPPER_CLASS } from './renderDashboardPreview.js';

// Minimal shape of the host context this control reads — avoids depending on a type that isn't
// re-exported from the package root.
type HostCtx = { displayMode?: string; availableDisplayModes?: string[] };

/** Builds `.main > #tableauVizContainer` and, optionally, a `.dashboard-preview` wrapper inside it. */
function buildDom({ withPreview }: { withPreview: boolean }): void {
  const main = document.createElement('div');
  main.className = 'main';
  const container = document.createElement('div');
  container.id = 'tableauVizContainer';
  main.appendChild(container);
  if (withPreview) {
    const preview = document.createElement('div');
    preview.className = PREVIEW_WRAPPER_CLASS;
    container.appendChild(preview);
  }
  document.body.appendChild(main);
}

/** A mock App whose host context is a mutable object the test can drive. */
function mockApp(ctx: HostCtx | undefined): {
  app: App;
  requestDisplayMode: ReturnType<typeof vi.fn>;
  fireContextChanged: () => void;
} {
  const requestDisplayMode = vi.fn();
  const app = {
    getHostContext: () => ctx,
    requestDisplayMode,
    onhostcontextchanged: undefined as ((p: unknown) => void) | undefined,
  };
  return {
    app: app as unknown as App,
    requestDisplayMode,
    fireContextChanged: () => app.onhostcontextchanged?.({}),
  };
}

const button = (): HTMLButtonElement | null =>
  document.querySelector<HTMLButtonElement>(`.${EXPAND_BUTTON_CLASS}`);
const mainIsFullscreen = (): boolean =>
  document.querySelector('.main')!.classList.contains(FULLSCREEN_CLASS);

/** Invokes the button's async onclick and awaits its promise (onclick is typed for PointerEvent). */
async function clickButton(): Promise<void> {
  const handler = button()!.onclick as ((e: Event) => unknown) | null;
  await handler?.(new MouseEvent('click'));
}

describe('setupExpandControl', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('renders no button when there is no preview to enlarge', () => {
    buildDom({ withPreview: false });
    const { app } = mockApp({ availableDisplayModes: ['inline', 'fullscreen'] });
    expect(setupExpandControl(app)).toBe(false);
    expect(button()).toBeNull();
  });

  it('renders no button when the host does not advertise fullscreen', () => {
    buildDom({ withPreview: true });
    const { app } = mockApp({ availableDisplayModes: ['inline'] });
    expect(setupExpandControl(app)).toBe(false);
    expect(button()).toBeNull();
  });

  it('renders no button when the host context is absent', () => {
    buildDom({ withPreview: true });
    const { app } = mockApp(undefined);
    expect(setupExpandControl(app)).toBe(false);
    expect(button()).toBeNull();
  });

  it('inserts an Expand button on the preview when fullscreen is available', () => {
    buildDom({ withPreview: true });
    const { app } = mockApp({
      displayMode: 'inline',
      availableDisplayModes: ['inline', 'fullscreen'],
    });

    expect(setupExpandControl(app)).toBe(true);
    const btn = button()!;
    expect(btn).toBeTruthy();
    // Attached to the preview wrapper, not the bare container.
    expect(btn.parentElement!.className).toBe(PREVIEW_WRAPPER_CLASS);
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(btn.getAttribute('aria-label')).toBe('Expand dashboard preview');
    expect(btn.textContent).toContain('Expand');
    expect(mainIsFullscreen()).toBe(false);
  });

  it('requests fullscreen on click and reflects the mode the host actually set', async () => {
    buildDom({ withPreview: true });
    const ctx: HostCtx = {
      displayMode: 'inline',
      availableDisplayModes: ['inline', 'fullscreen'],
    };
    const { app, requestDisplayMode } = mockApp(ctx);
    requestDisplayMode.mockResolvedValue({ mode: 'fullscreen' });

    setupExpandControl(app);
    await clickButton();

    expect(requestDisplayMode).toHaveBeenCalledWith({ mode: 'fullscreen' });
    expect(mainIsFullscreen()).toBe(true);
    expect(button()!.getAttribute('aria-pressed')).toBe('true');
    expect(button()!.textContent).toContain('Collapse');
  });

  it('drives the UI off the ACTUAL returned mode when the host declines', async () => {
    buildDom({ withPreview: true });
    const { app, requestDisplayMode } = mockApp({
      displayMode: 'inline',
      availableDisplayModes: ['inline', 'fullscreen'],
    });
    // Host clamps back to inline despite the fullscreen request.
    requestDisplayMode.mockResolvedValue({ mode: 'inline' });

    setupExpandControl(app);
    await clickButton();

    expect(requestDisplayMode).toHaveBeenCalledWith({ mode: 'fullscreen' });
    expect(mainIsFullscreen()).toBe(false); // stayed inline — we trusted the returned mode
    expect(button()!.textContent).toContain('Expand');
  });

  it('toggles back to inline when clicked while fullscreen', async () => {
    buildDom({ withPreview: true });
    const ctx: HostCtx = {
      displayMode: 'fullscreen',
      availableDisplayModes: ['inline', 'fullscreen'],
    };
    const { app, requestDisplayMode } = mockApp(ctx);
    requestDisplayMode.mockResolvedValue({ mode: 'inline' });

    setupExpandControl(app);
    // Started fullscreen: button should say Collapse.
    expect(button()!.textContent).toContain('Collapse');

    await clickButton();
    expect(requestDisplayMode).toHaveBeenCalledWith({ mode: 'inline' });
    expect(mainIsFullscreen()).toBe(false);
  });

  it('re-syncs when the host changes the mode on its own (host-driven exit)', () => {
    buildDom({ withPreview: true });
    const ctx: HostCtx = {
      displayMode: 'fullscreen',
      availableDisplayModes: ['inline', 'fullscreen'],
    };
    const { app, fireContextChanged } = mockApp(ctx);

    setupExpandControl(app);
    expect(mainIsFullscreen()).toBe(true);

    // User exits fullscreen via the host's own chrome; host notifies us.
    ctx.displayMode = 'inline';
    fireContextChanged();

    expect(mainIsFullscreen()).toBe(false);
    expect(button()!.textContent).toContain('Expand');
  });
});
