/**
 * @vitest-environment jsdom
 */
import type { App } from '@modelcontextprotocol/ext-apps';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isPublishedWorkbookResult, renderPublishedWorkbookCard } from './publishedWorkbookCard.js';

const validPayload = {
  appView: 'published-workbook-card' as const,
  name: 'WorldCup2026RegionalSalesAnalysis',
  url: 'https://main-windows/#/site/AdminProfiles/workbooks/4122',
  projectId: 'proj-abc',
};

function makeApp(overrides?: Partial<App>): App {
  return {
    getHostCapabilities: vi.fn().mockReturnValue({ openLinks: {} }),
    openLink: vi.fn().mockResolvedValue({ isError: false }),
    ...overrides,
  } as unknown as App;
}

describe('isPublishedWorkbookResult', () => {
  it('accepts a well-formed published-workbook payload', () => {
    expect(isPublishedWorkbookResult(validPayload)).toBe(true);
  });

  it('rejects a payload with the wrong appView', () => {
    expect(isPublishedWorkbookResult({ ...validPayload, appView: 'something-else' })).toBe(false);
  });

  it('rejects a payload missing appView (e.g. the embed-a-viz result)', () => {
    expect(isPublishedWorkbookResult({ url: validPayload.url })).toBe(false);
  });

  it('accepts a payload with no url (a successful publish with no server webpageUrl)', () => {
    const { url: _omitted, ...noUrl } = validPayload;
    expect(isPublishedWorkbookResult(noUrl)).toBe(true);
  });

  it('rejects a payload whose url is not a valid URL', () => {
    expect(isPublishedWorkbookResult({ ...validPayload, url: 'not a url' })).toBe(false);
  });
});

describe('renderPublishedWorkbookCard', () => {
  beforeEach(() => {
    const main = document.createElement('div');
    main.className = 'main';
    const container = document.createElement('div');
    container.id = 'tableauVizContainer';
    main.appendChild(container);
    document.body.appendChild(main);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('renders a single clickable card linking to the workbook url', () => {
    renderPublishedWorkbookCard(makeApp(), validPayload);

    const container = document.getElementById('tableauVizContainer');
    const card = container?.querySelector('a.pub-card');
    expect(card).toBeTruthy();
    expect(card?.getAttribute('href')).toBe(validPayload.url);
    expect(card?.getAttribute('rel')).toBe('noopener noreferrer');

    // Never embeds a viz.
    expect(container?.querySelector('tableau-viz')).toBeNull();
  });

  it('renders the workbook name as the title via textContent (no injection)', () => {
    const xssName = '<img src=x onerror=alert(1)>';
    renderPublishedWorkbookCard(makeApp(), { ...validPayload, name: xssName });

    const title = document.querySelector('.pub-card-title');
    expect(title?.textContent).toBe(xssName);
    // Set as text, not parsed as HTML — no injected <img> element.
    expect(document.querySelector('.pub-card-title img')).toBeNull();
  });

  it('shows the "Published" badge', () => {
    renderPublishedWorkbookCard(makeApp(), validPayload);
    expect(document.querySelector('.pub-card-badge')?.textContent).toContain('Published');
  });

  it('renders the real project name when projectName is present', () => {
    renderPublishedWorkbookCard(makeApp(), { ...validPayload, projectName: 'Default' });
    expect(document.querySelector('.pub-card-project')?.textContent).toBe('Default');
  });

  it('renders the project name via textContent (no injection)', () => {
    const xssProject = '<img src=x onerror=alert(1)>';
    renderPublishedWorkbookCard(makeApp(), { ...validPayload, projectName: xssProject });
    expect(document.querySelector('.pub-card-project')?.textContent).toBe(xssProject);
    expect(document.querySelector('.pub-card-project img')).toBeNull();
  });

  it('falls back to a generic label when a projectId is supplied but no projectName', () => {
    renderPublishedWorkbookCard(makeApp(), validPayload);
    expect(document.querySelector('.pub-card-project')?.textContent).toBe('Project');
  });

  it('falls back to the default-project label when neither projectName nor projectId is present', () => {
    const { projectId: _omitted, ...noProject } = validPayload;
    renderPublishedWorkbookCard(makeApp(), noProject);
    expect(document.querySelector('.pub-card-project')?.textContent).toBe('Default project');
  });

  it('opens via the host when openLinks is supported (preventing default navigation)', async () => {
    const app = makeApp();
    renderPublishedWorkbookCard(app, validPayload);

    const card = document.querySelector('a.pub-card') as HTMLAnchorElement;
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    card.dispatchEvent(event);
    await new Promise((r) => setTimeout(r, 0));

    expect(event.defaultPrevented).toBe(true);
    expect(vi.mocked(app.openLink)).toHaveBeenCalledWith({ url: validPayload.url });
  });

  it('renders non-fatal builder warnings below the card via textContent (no injection)', () => {
    const xssWarning = '<img src=x onerror=alert(1)> data.parquet may 404';
    renderPublishedWorkbookCard(makeApp(), {
      ...validPayload,
      warnings: ['First advisory', xssWarning],
    });

    const warnings = document.querySelectorAll('.pub-card-warning');
    expect(warnings.length).toBe(2);
    expect(warnings[0].textContent).toBe('First advisory');
    expect(warnings[1].textContent).toBe(xssWarning);
    // Set as text, not parsed as HTML — no injected <img> element.
    expect(document.querySelector('.pub-card-warnings img')).toBeNull();
    // Warnings live outside the clickable card anchor.
    expect(document.querySelector('a.pub-card .pub-card-warnings')).toBeNull();
  });

  it('renders no warnings section when warnings are absent or empty', () => {
    renderPublishedWorkbookCard(makeApp(), { ...validPayload, warnings: ['   ', ''] });
    expect(document.querySelector('.pub-card-warnings')).toBeNull();

    renderPublishedWorkbookCard(makeApp(), validPayload);
    expect(document.querySelector('.pub-card-warnings')).toBeNull();
  });

  it('accepts a payload carrying warnings and passthrough traceability fields', () => {
    expect(
      isPublishedWorkbookResult({
        ...validPayload,
        warnings: ['advisory'],
        validationId: 'a'.repeat(32),
        digest: 'c'.repeat(64),
      }),
    ).toBe(true);
  });

  it('does not attach a host-open handler when openLinks is unsupported', () => {
    const app = makeApp({ getHostCapabilities: vi.fn().mockReturnValue({}) });
    renderPublishedWorkbookCard(app, validPayload);

    const card = document.querySelector('a.pub-card') as HTMLAnchorElement;
    // No onclick override — the plain anchor href carries the navigation.
    expect(card.onclick).toBeNull();
  });

  describe('when url is absent (successful publish with no server webpageUrl)', () => {
    const { url: _omitted, ...noUrlPayload } = validPayload;

    it('renders a non-clickable card instead of a link', () => {
      renderPublishedWorkbookCard(makeApp(), noUrlPayload);

      const container = document.getElementById('tableauVizContainer');
      expect(container?.querySelector('a.pub-card')).toBeNull();
      const card = container?.querySelector('div.pub-card');
      expect(card).toBeTruthy();
      expect(card?.hasAttribute('href')).toBe(false);
    });

    it('still renders the workbook name and project', () => {
      renderPublishedWorkbookCard(makeApp(), { ...noUrlPayload, projectName: 'Default' });

      expect(document.querySelector('.pub-card-title')?.textContent).toBe(noUrlPayload.name);
      expect(document.querySelector('.pub-card-project')?.textContent).toBe('Default');
    });

    it('shows the workbook id in place of the "Open" affordance', () => {
      renderPublishedWorkbookCard(makeApp(), { ...noUrlPayload, id: 'wb-123' });

      expect(document.querySelector('.pub-card-open')).toBeNull();
      expect(document.querySelector('.pub-card-id')?.textContent).toBe('ID: wb-123');
    });

    it('omits the trailing affordance entirely when neither url nor id is known', () => {
      renderPublishedWorkbookCard(makeApp(), noUrlPayload);

      expect(document.querySelector('.pub-card-open')).toBeNull();
      expect(document.querySelector('.pub-card-id')).toBeNull();
    });

    it('never attaches a host-open click handler', () => {
      const app = makeApp();
      renderPublishedWorkbookCard(app, noUrlPayload);

      const card = document.querySelector('div.pub-card') as HTMLDivElement;
      expect(card.onclick).toBeNull();
      expect(vi.mocked(app.openLink)).not.toHaveBeenCalled();
    });
  });
});
