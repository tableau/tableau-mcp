import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import puppeteer, { Browser, BrowserContext, CDPSession, Page } from 'puppeteer';
import { ScreenshotOptions } from 'puppeteer-core';
import { Err, Ok, Result } from 'ts-results-es';

import { getDirname } from '../../utils/getDirname';

export type BrowserOptions = {
  width?: number;
  height?: number;
};

const browserControllerErrors = [
  'browser-creation-failed',
  'browser-context-creation-failed',
  'page-creation-failed',
  'enable-downloads-failed',
  'download-failed',
  'navigation-failed',
  'page-failed-to-load',
  'viz-load-error',
  'screenshot-failed',
  'unknown',
] as const;

type BrowserControllerErrorType = (typeof browserControllerErrors)[number];

export function isBrowserControllerErrorType(value: unknown): value is BrowserControllerErrorType {
  return browserControllerErrors.find((error) => error === value) !== undefined;
}

export type BrowserControllerError = {
  type: BrowserControllerErrorType;
  error: unknown;
};

export class BrowserController {
  private _error: BrowserControllerError | undefined;
  private _browser: Browser | undefined;
  private _browserContext: BrowserContext | undefined;
  private _page: Page | undefined;
  private _browserCDPSession: CDPSession | undefined;
  private _downloadPath: string | undefined;
  private _screenshot: Uint8Array | undefined;

  private constructor() {}

  static async use<T>(
    options: { headless?: boolean } = {},
    callback: (controller: Pick<BrowserController, 'createNewPage' | 'close'>) => Promise<T>,
  ): Promise<T> {
    const browserController = await BrowserController.create(options);
    try {
      return await callback(browserController);
    } finally {
      browserController.close();
    }
  }

  private static async create({ headless = true }: { headless?: boolean } = {}): Promise<
    Pick<BrowserController, 'createNewPage' | 'close'>
  > {
    return Promise.resolve(new BrowserController())
      .then((renderer) => renderer._createBrowser({ headless }))
      .then((renderer) => renderer._createBrowserContext());
  }

  private get browser(): Browser {
    if (!this._browser) {
      throw new Error('Browser not created');
    }

    return this._browser;
  }

  private get browserContext(): BrowserContext {
    if (!this._browserContext) {
      throw new Error('Browser context not created');
    }

    return this._browserContext;
  }

  get page(): Page {
    if (!this._page) {
      throw new Error('Page not created');
    }

    return this._page;
  }

  get screenshot(): Uint8Array {
    if (!this._screenshot) {
      throw new Error('Screenshot not taken');
    }

    return this._screenshot;
  }

  private get downloadPath(): string {
    if (!this._downloadPath) {
      throw new Error('Download path not set');
    }

    return this._downloadPath;
  }

  private get browserCDPSession(): CDPSession {
    if (!this._browserCDPSession) {
      throw new Error('Browser CDP session not created');
    }

    return this._browserCDPSession;
  }

  private async _createBrowser({ headless }: { headless: boolean }): Promise<this> {
    try {
      this._browser = await puppeteer.launch({
        headless,
      });
    } catch (error) {
      this._error = { type: 'browser-creation-failed', error };
    }

    return this;
  }

  private async _createBrowserContext(): Promise<this> {
    if (this._error) {
      return this;
    }

    try {
      this._browserContext = await this.browser.createBrowserContext();
    } catch (error) {
      this._error = { type: 'browser-context-creation-failed', error };
    }

    return this;
  }

  async createNewPage(
    options: BrowserOptions,
  ): Promise<Pick<BrowserController, 'enableDownloads' | 'navigate'>> {
    if (this._error) {
      return this;
    }

    try {
      this._page = await this.browserContext.newPage();
      await this._page.setViewport({
        width: options.width ?? 800,
        height: options.height ?? 600,
      });
    } catch (error) {
      this._error = { type: 'page-creation-failed', error };
    }

    return this;
  }

  async enableDownloads(): Promise<Pick<BrowserController, 'navigate'>> {
    if (this._error) {
      return this;
    }

    try {
      this._browserCDPSession = await this.browser.target().createCDPSession();
      this._downloadPath = path.resolve(getDirname(), 'downloads', randomUUID());
      if (!fs.existsSync(this._downloadPath)) {
        fs.mkdirSync(this._downloadPath, { recursive: true });
      }

      const pageCDPSession = await this.page.createCDPSession();
      await pageCDPSession.send('Page.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: this._downloadPath,
      });

      await this._browserCDPSession.send('Browser.setDownloadBehavior', {
        behavior: 'allowAndName',
        downloadPath: this._downloadPath,
        eventsEnabled: true,
      });
    } catch (error) {
      this._error = { type: 'enable-downloads-failed', error };
    }

    return this;
  }

  async navigate(url: string): Promise<Pick<BrowserController, 'waitForPageLoad'>> {
    if (this._error) {
      return this;
    }

    try {
      await this.page.goto(url, { waitUntil: 'networkidle2' });
    } catch (error) {
      this._error = { type: 'navigation-failed', error };
    }

    return this;
  }

  async waitForPageLoad(): Promise<Pick<BrowserController, 'takeScreenshot' | 'getResult'>> {
    if (this._error) {
      return this;
    }

    try {
      const handle = await this.page.waitForFunction(isPageLoadedAndStable, { timeout: 10000 });
      const result = await handle.jsonValue();
      if (result && result.state === 'error') {
        this._error = { type: 'viz-load-error', error: JSON.parse(result.message) };
      }
    } catch (error) {
      this._error = { type: 'unknown', error };
    }

    return this;
  }

  async takeScreenshot(): Promise<Pick<BrowserController, 'takeScreenshot' | 'getResult'>> {
    if (this._error) {
      return this;
    }

    try {
      const screenshotOptions: ScreenshotOptions = {
        type: 'png',
        fullPage: true,
        omitBackground: false,
      };

      this._screenshot = await this.page.screenshot(screenshotOptions);
    } catch (error) {
      this._error = { type: 'screenshot-failed', error };
    }

    return this;
  }

  async waitForDownloads(): Promise<Pick<BrowserController, 'getResult'>> {
    if (this._error) {
      return this;
    }

    try {
      await new Promise<void>((resolve, reject) => {
        this.browserCDPSession.on('Browser.downloadProgress', (e) => {
          if (e.state === 'completed') {
            resolve();
          } else if (e.state === 'canceled') {
            reject('Download canceled');
          }
        });
      });
    } catch (error) {
      this._error = { type: 'download-failed', error };
    }

    return this;
  }

  async getAndDeleteDownloads(): Promise<Array<{ filename: string; content: string }>> {
    const files = fs.readdirSync(this.downloadPath);
    const fileContents = files.map((filename) => ({
      filename,
      content: fs.readFileSync(path.join(this.downloadPath, filename), 'utf8'),
    }));

    fs.rmdirSync(this.downloadPath, { recursive: true });
    return fileContents;
  }

  async getResult(): Promise<Result<this, BrowserControllerError>> {
    if (this._error) {
      return Err(this._error);
    }

    return Ok(this);
  }

  close(): void {
    this._page?.close().catch(() => {});
    this._browserContext?.close().catch(() => {});
    this._browser?.close().catch(() => {});
  }
}

function isPageLoadedAndStable():
  | false
  | { state: 'loaded' }
  | { state: 'error'; message: string } {
  const navigationTiming = performance?.getEntriesByType?.('navigation')[0];

  if (!navigationTiming?.duration) {
    return false;
  }

  if (![undefined, 'complete'].includes(document?.readyState)) {
    return false;
  }

  if (document.querySelector('div[id="success"]')) {
    return { state: 'loaded' };
  }

  const errorDiv = document.querySelector('div[id="error"]');
  if (errorDiv) {
    return { state: 'error', message: errorDiv.textContent ?? '' };
  }

  return false;
}

export function getBrowserControllerErrorMessage(error: BrowserControllerErrorType): string {
  switch (error) {
    case 'browser-creation-failed':
      return 'Failed to create browser.';
    case 'browser-context-creation-failed':
      return 'Failed to create browser context.';
    case 'page-creation-failed':
      return 'Failed to create page.';
    case 'enable-downloads-failed':
      return 'Failed to enable downloads.';
    case 'download-failed':
      return 'Failed to download files.';
    case 'navigation-failed':
      return 'Failed to navigate to the page.';
    case 'page-failed-to-load':
      return 'Failed to load the page.';
    case 'viz-load-error':
      return 'Failed to load the viz.';
    case 'screenshot-failed':
      return 'Failed to take a screenshot of the page.';
    case 'unknown':
      return 'Unknown error.';
  }
}
