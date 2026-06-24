/**
 * @vitest-environment jsdom
 */
import type { App } from '@modelcontextprotocol/ext-apps';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setupOpenInTableauLink } from './openInTableauLink.js';

describe('setupOpenInTableauLink', () => {
  let mockApp: App;
  let linkElement: HTMLAnchorElement;

  beforeEach(() => {
    // Create link element
    linkElement = document.createElement('a');
    linkElement.id = 'openInTableauLink';
    linkElement.hidden = true;
    document.body.appendChild(linkElement);

    // Create mock App with openLink and getHostCapabilities
    mockApp = {
      openLink: vi.fn().mockResolvedValue({}),
      getHostCapabilities: vi.fn().mockReturnValue({ openLinks: true }),
    } as unknown as App;
  });

  afterEach(() => {
    linkElement.remove();
  });

  it('should reveal link and set href when URL is provided and host supports openLinks', () => {
    const url = 'https://tableau.example.com/views/workbook/view';

    setupOpenInTableauLink(mockApp, url);

    expect(linkElement.hidden).toBe(false);
    expect(linkElement.getAttribute('href')).toBe(url);
  });

  it('should keep link hidden when URL is empty', () => {
    setupOpenInTableauLink(mockApp, '');

    expect(linkElement.hidden).toBe(true);
  });

  it('should keep link hidden when host lacks openLinks capability', () => {
    mockApp.getHostCapabilities = vi.fn().mockReturnValue({});
    const url = 'https://tableau.example.com/views/workbook/view';

    setupOpenInTableauLink(mockApp, url);

    expect(linkElement.hidden).toBe(true);
  });

  it('should keep link hidden when host capabilities are undefined', () => {
    mockApp.getHostCapabilities = vi.fn().mockReturnValue(undefined);
    const url = 'https://tableau.example.com/views/workbook/view';

    setupOpenInTableauLink(mockApp, url);

    expect(linkElement.hidden).toBe(true);
  });

  it('should call app.openLink when link is clicked', async () => {
    const url = 'https://tableau.example.com/views/workbook/view';

    setupOpenInTableauLink(mockApp, url);

    // Click the link
    linkElement.click();

    // Wait for async handler
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockApp.openLink).toHaveBeenCalledWith({ url });
  });

  it('should call preventDefault when link is clicked', () => {
    const url = 'https://tableau.example.com/views/workbook/view';

    setupOpenInTableauLink(mockApp, url);

    // Create click event with preventDefault spy
    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    const preventDefaultSpy = vi.spyOn(clickEvent, 'preventDefault');

    linkElement.dispatchEvent(clickEvent);

    expect(preventDefaultSpy).toHaveBeenCalled();
  });

  it('should log warning when openLink returns isError true', async () => {
    const url = 'https://tableau.example.com/views/workbook/view';
    mockApp.openLink = vi.fn().mockResolvedValue({ isError: true });
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    setupOpenInTableauLink(mockApp, url);

    // Click the link
    linkElement.click();

    // Wait for async handler
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('denied'),
      expect.objectContaining({ url }),
    );

    consoleWarnSpy.mockRestore();
  });

  it('should handle openLink throwing an error', async () => {
    const url = 'https://tableau.example.com/views/workbook/view';
    mockApp.openLink = vi.fn().mockRejectedValue(new Error('Connection lost'));
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    setupOpenInTableauLink(mockApp, url);

    // Click the link
    linkElement.click();

    // Wait for async handler
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('failed'),
      expect.objectContaining({ url }),
    );

    consoleWarnSpy.mockRestore();
  });
});
