/**
 * @vitest-environment jsdom
 */
import type { App } from '@modelcontextprotocol/ext-apps';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setupOpenInTableauLink } from './openInTableauLink.js';

describe('setupOpenInTableauLink', () => {
  let mockApp: App;
  let container: HTMLElement;

  beforeEach(() => {
    // Create container element (simulating the main element)
    container = document.createElement('main');
    container.className = 'main';
    document.body.appendChild(container);

    // Create mock App with openLink and getHostCapabilities
    mockApp = {
      openLink: vi.fn().mockResolvedValue({}),
      getHostCapabilities: vi.fn().mockReturnValue({ openLinks: true }),
    } as unknown as App;

    // Silence the expected console.warn output from the link-open failure paths these tests exercise.
    // Nothing asserts on console; this only keeps test output clean.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
  });

  it('should create link with correct attributes and reveal when URL is provided and host supports openLinks', () => {
    const url = 'https://tableau.example.com/views/workbook/view';

    setupOpenInTableauLink(mockApp, url, container);

    const linkElement = container.querySelector('#openInTableauLink') as HTMLAnchorElement;
    expect(linkElement).not.toBeNull();
    expect(linkElement.id).toBe('openInTableauLink');
    expect(linkElement.className).toBe('open-in-tableau');
    expect(linkElement.getAttribute('rel')).toBe('noopener noreferrer');
    expect(linkElement.getAttribute('aria-label')).toBe(
      'Open in Tableau (opens in a new browser tab)',
    );
    expect(linkElement.textContent).toBe('Open in Tableau ↗');
    expect(linkElement.hidden).toBe(false);
    expect(linkElement.getAttribute('href')).toBe(url);
  });

  it('should not create link when URL is empty', () => {
    setupOpenInTableauLink(mockApp, '', container);

    const linkElement = container.querySelector('#openInTableauLink');
    expect(linkElement).toBeNull();
  });

  it('should not create link when host lacks openLinks capability', () => {
    mockApp.getHostCapabilities = vi.fn().mockReturnValue({});
    const url = 'https://tableau.example.com/views/workbook/view';

    setupOpenInTableauLink(mockApp, url, container);

    const linkElement = container.querySelector('#openInTableauLink');
    expect(linkElement).toBeNull();
  });

  it('should not create link when host capabilities are undefined', () => {
    mockApp.getHostCapabilities = vi.fn().mockReturnValue(undefined);
    const url = 'https://tableau.example.com/views/workbook/view';

    setupOpenInTableauLink(mockApp, url, container);

    const linkElement = container.querySelector('#openInTableauLink');
    expect(linkElement).toBeNull();
  });

  it('should call app.openLink when link is clicked', async () => {
    const url = 'https://tableau.example.com/views/workbook/view';

    setupOpenInTableauLink(mockApp, url, container);

    const linkElement = container.querySelector('#openInTableauLink') as HTMLAnchorElement;
    expect(linkElement).not.toBeNull();

    // Click the link
    linkElement.click();

    // Wait for async handler
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockApp.openLink).toHaveBeenCalledWith({ url });
  });

  it('should call preventDefault when link is clicked', () => {
    const url = 'https://tableau.example.com/views/workbook/view';

    setupOpenInTableauLink(mockApp, url, container);

    const linkElement = container.querySelector('#openInTableauLink') as HTMLAnchorElement;
    expect(linkElement).not.toBeNull();

    // Create click event with preventDefault spy
    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    const preventDefaultSpy = vi.spyOn(clickEvent, 'preventDefault');

    linkElement.dispatchEvent(clickEvent);

    expect(preventDefaultSpy).toHaveBeenCalled();
  });

  it('should show inline error when openLink returns isError true', async () => {
    const url = 'https://tableau.example.com/views/workbook/view';
    mockApp.openLink = vi.fn().mockResolvedValue({ isError: true });

    setupOpenInTableauLink(mockApp, url, container);

    const linkElement = container.querySelector('#openInTableauLink') as HTMLAnchorElement;
    expect(linkElement).not.toBeNull();

    // Click the link
    linkElement.click();

    // Wait for the async click handler to render the inline error
    await vi.waitFor(() => {
      expect(container.querySelector('.open-in-tableau-error')).not.toBeNull();
    });

    const errorMessage = container.querySelector('.open-in-tableau-error');
    expect(errorMessage?.textContent).toBe('The URL was unable to be opened.');
  });

  it('should show inline error when openLink throws', async () => {
    const url = 'https://tableau.example.com/views/workbook/view';
    mockApp.openLink = vi.fn().mockRejectedValue(new Error('Connection lost'));

    setupOpenInTableauLink(mockApp, url, container);

    const linkElement = container.querySelector('#openInTableauLink') as HTMLAnchorElement;
    expect(linkElement).not.toBeNull();

    // Click the link
    linkElement.click();

    // Wait for the async click handler to render the inline error
    await vi.waitFor(() => {
      expect(container.querySelector('.open-in-tableau-error')).not.toBeNull();
    });

    const errorMessage = container.querySelector('.open-in-tableau-error');
    expect(errorMessage?.textContent).toBe('The URL was unable to be opened.');
  });

  it('should be idempotent - calling twice results in exactly one link', () => {
    const url = 'https://tableau.example.com/views/workbook/view';

    // Call setupOpenInTableauLink twice
    setupOpenInTableauLink(mockApp, url, container);
    setupOpenInTableauLink(mockApp, url, container);

    // Should have exactly one link in the container
    const linkElements = container.querySelectorAll('#openInTableauLink');
    expect(linkElements.length).toBe(1);
  });

  it('should remove existing link when called with empty URL', () => {
    const url = 'https://tableau.example.com/views/workbook/view';

    // First call creates the link
    setupOpenInTableauLink(mockApp, url, container);
    let linkElement = container.querySelector('#openInTableauLink');
    expect(linkElement).not.toBeNull();

    // Second call with empty URL should remove it
    setupOpenInTableauLink(mockApp, '', container);
    linkElement = container.querySelector('#openInTableauLink');
    expect(linkElement).toBeNull();
  });

  it('should remove existing link when host lacks openLinks capability', () => {
    const url = 'https://tableau.example.com/views/workbook/view';

    // First call creates the link
    setupOpenInTableauLink(mockApp, url, container);
    let linkElement = container.querySelector('#openInTableauLink');
    expect(linkElement).not.toBeNull();

    // Second call with no openLinks capability should remove it
    mockApp.getHostCapabilities = vi.fn().mockReturnValue({});
    setupOpenInTableauLink(mockApp, url, container);
    linkElement = container.querySelector('#openInTableauLink');
    expect(linkElement).toBeNull();
  });

  it('should show inline error message when openLink returns isError', async () => {
    const url = 'https://tableau.example.com/views/workbook/view';
    mockApp.openLink = vi.fn().mockResolvedValue({ isError: true });

    setupOpenInTableauLink(mockApp, url, container);

    const linkElement = container.querySelector('#openInTableauLink') as HTMLAnchorElement;
    expect(linkElement).not.toBeNull();

    // Click the link
    linkElement.click();

    // Wait for async handler
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Verify inline error message was created
    const errorMessage = container.querySelector('.open-in-tableau-error') as HTMLElement;
    expect(errorMessage).not.toBeNull();
    expect(errorMessage.textContent).toBe('The URL was unable to be opened.');
  });

  it('should show inline error message when openLink throws error', async () => {
    const url = 'https://tableau.example.com/views/workbook/view';
    mockApp.openLink = vi.fn().mockRejectedValue(new Error('Connection lost'));

    setupOpenInTableauLink(mockApp, url, container);

    const linkElement = container.querySelector('#openInTableauLink') as HTMLAnchorElement;
    expect(linkElement).not.toBeNull();

    // Click the link
    linkElement.click();

    // Wait for async handler
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Verify inline error message was created
    const errorMessage = container.querySelector('.open-in-tableau-error') as HTMLElement;
    expect(errorMessage).not.toBeNull();
    expect(errorMessage.textContent).toBe('The URL was unable to be opened.');
  });

  it('should reuse existing error message element on repeated failures', async () => {
    const url = 'https://tableau.example.com/views/workbook/view';
    mockApp.openLink = vi.fn().mockResolvedValue({ isError: true });

    setupOpenInTableauLink(mockApp, url, container);

    const linkElement = container.querySelector('#openInTableauLink') as HTMLAnchorElement;
    expect(linkElement).not.toBeNull();

    // Click the link twice
    linkElement.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    linkElement.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Should have exactly one error message element
    const errorMessages = container.querySelectorAll('.open-in-tableau-error');
    expect(errorMessages.length).toBe(1);
  });

  it('should clear a pre-existing error message when a later openLink succeeds', async () => {
    const url = 'https://tableau.example.com/views/workbook/view';
    // First attempt fails, second attempt succeeds.
    mockApp.openLink = vi.fn().mockResolvedValueOnce({ isError: true }).mockResolvedValueOnce({});

    setupOpenInTableauLink(mockApp, url, container);

    const linkElement = container.querySelector('#openInTableauLink') as HTMLAnchorElement;
    expect(linkElement).not.toBeNull();

    // First click fails and shows the error message.
    linkElement.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container.querySelector('.open-in-tableau-error')).not.toBeNull();

    // Second click succeeds and should clear the leftover error message.
    linkElement.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container.querySelector('.open-in-tableau-error')).toBeNull();
  });
});
