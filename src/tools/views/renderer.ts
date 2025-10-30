import { randomUUID } from 'crypto';
import fs from 'fs';
import path, { dirname } from 'path';
import { Browser, BrowserContext, CDPSession, Page } from 'puppeteer';
import puppeteer, { ScreenshotOptions } from 'puppeteer-core';
import { Err, Ok, Result } from 'ts-results-es';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export type BrowserOptions = {
  width?: number;
  height?: number;
};

export type RendererError = {
  type:
    | 'browser-context-creation-failed'
    | 'page-creation-failed'
    | 'enable-downloads-failed'
    | 'navigation-failed'
    | 'page-failed-to-load'
    | 'viz-load-error'
    | 'screenshot-failed'
    | 'unknown';
  error: unknown;
};

export class Renderer {
  private _browser: Browser;
  private _error: RendererError | null = null;
  private _browserContext: BrowserContext | null = null;
  private _page: Page | null = null;
  private _pageCDPSession: CDPSession | null = null;
  private _browserCDPSession: CDPSession | null = null;
  private _downloadPath: string | null = null;
  private _screenshot: Uint8Array | null = null;

  private constructor(browser: Browser) {
    this._browser = browser;
  }

  static async create({ headless = true }: { headless?: boolean } = {}): Promise<Renderer> {
    const browser = await puppeteer.launch({
      headless,
    });
    return new Renderer(browser);
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

  get browserCDPSession(): CDPSession {
    if (!this._browserCDPSession) {
      throw new Error('Browser CDP session not created');
    }

    return this._browserCDPSession;
  }

  get downloadPath(): string {
    if (!this._downloadPath) {
      throw new Error('Download path not set');
    }

    return this._downloadPath;
  }

  async createBrowserContext(): Promise<this> {
    if (this._error) {
      return this;
    }

    try {
      this._browserContext = await this._browser.createBrowserContext();
    } catch (error) {
      this._error = { type: 'browser-context-creation-failed', error };
    }

    return this;
  }

  async createNewPage(options: BrowserOptions): Promise<this> {
    if (this._error) {
      return this;
    }

    if (!this._browserContext) {
      throw new Error('Browser context not created');
    }

    try {
      this._page = await this._browserContext.newPage();
      await this._page.setViewport({
        width: options.width ?? 800,
        height: options.height ?? 600,
      });
    } catch (error) {
      this._error = { type: 'page-creation-failed', error };
    }

    return this;
  }

  async enableDownloads(): Promise<this> {
    if (this._error) {
      return this;
    }

    if (!this._page) {
      throw new Error('Page not created');
    }

    try {
      this._browserCDPSession = await this._browser.target().createCDPSession();
      this._downloadPath = path.resolve(__dirname, 'downloads', randomUUID());
      if (!fs.existsSync(this._downloadPath)) {
        fs.mkdirSync(this._downloadPath, { recursive: true });
      }

      this._pageCDPSession = await this._page.createCDPSession();
      await this._pageCDPSession.send('Page.setDownloadBehavior', {
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

  async navigate(url: string): Promise<this> {
    if (this._error) {
      return this;
    }

    if (!this._page) {
      throw new Error('Page not created');
    }

    try {
      await this._page.goto(url, { waitUntil: 'networkidle2' });
    } catch (error) {
      this._error = { type: 'navigation-failed', error };
    }

    return this;
  }

  async waitForPageLoad(): Promise<this> {
    if (this._error) {
      return this;
    }

    if (!this._page) {
      throw new Error('Page not created');
    }

    try {
      const handle = await this._page.waitForFunction(isPageLoadedAndStable, { timeout: 10000 });
      const result = await handle.jsonValue();
      if (result && result.state === 'error') {
        this._error = { type: 'viz-load-error', error: JSON.parse(result.message) };
      }
    } catch (error) {
      this._error = { type: 'unknown', error };
    }

    return this;
  }

  async takeScreenshot(): Promise<this> {
    if (this._error) {
      return this;
    }

    if (!this._page) {
      throw new Error('Page not created');
    }

    try {
      const screenshotOptions: ScreenshotOptions = {
        type: 'png',
        fullPage: true,
        omitBackground: false,
      };

      this._screenshot = await this._page.screenshot(screenshotOptions);
    } catch (error) {
      this._error = { type: 'screenshot-failed', error };
    }

    return this;
  }

  async getResult(): Promise<Result<this, RendererError>> {
    if (this._error) {
      return Err(this._error);
    }

    try {
      await this._page?.close();
      await this._browserContext?.close();
    } catch {
      // ignore
    }

    return Ok(this);
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
