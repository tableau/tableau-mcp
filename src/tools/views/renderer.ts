import puppeteer, { Browser, BrowserContext, Page, ScreenshotOptions } from 'puppeteer';
import { Err, Ok, Result } from 'ts-results-es';

import { Server } from '../../server.js';

export type RendererOptions = {
  url: string;
  width: number;
  height: number;
};

export type RendererError = {
  type:
    | 'navigation-failed'
    | 'page-failed-to-load'
    | 'browser-context-creation-failed'
    | 'page-creation-failed'
    | 'screenshot-failed';
  error: unknown;
};

export class Renderer {
  private browser: Browser;

  private constructor(browser: Browser) {
    this.browser = browser;
  }

  static async create({ headless = true }: { headless?: boolean } = {}): Promise<Renderer> {
    const browser = await puppeteer.launch({
      headless,
    });

    return new Renderer(browser);
  }

  private async _getBrowserContext(): Promise<Result<BrowserContext, unknown>> {
    try {
      const context = await this.browser.createBrowserContext();
      return Ok(context);
    } catch (error) {
      return Err(error);
    }
  }

  private async _getPage(
    context: BrowserContext,
    options: RendererOptions,
  ): Promise<Result<Page, unknown>> {
    try {
      const page = await context.newPage();
      await page.setViewport({
        width: options.width,
        height: options.height,
      });

      return Ok(page);
    } catch (error) {
      return Err(error);
    }
  }

  private async _navigate(page: Page, url: string): Promise<Result<void, unknown>> {
    try {
      await page.goto(url, { waitUntil: 'networkidle2' });
    } catch (error) {
      return Err(error);
    }

    return Ok.EMPTY;
  }

  private async _waitForPageLoad(
    page: Page,
  ): Promise<Result<void, { type: 'viz-load-error' | 'unknown'; error: unknown }>> {
    try {
      const handle = await page.waitForFunction(isPageLoadedAndStable, { timeout: 10000 });
      const result = await handle.jsonValue();
      if (result && result.state === 'error') {
        return Err({ type: 'viz-load-error', error: JSON.parse(result.message) });
      }
    } catch (error) {
      return Err({ type: 'unknown', error });
    }

    return Ok.EMPTY;
  }

  private async _finalizePage(page: Page): Promise<void> {
    await page.emulateMediaType('screen');
  }

  private async _createPage(
    server: Server,
    url: string,
    options: RendererOptions,
  ): Promise<Result<Page, RendererError>> {
    const context = await this._getBrowserContext();
    if (context.isErr()) {
      return Err({ type: 'browser-context-creation-failed', error: context.error });
    }

    const pageResult = await this._getPage(context.value, options);
    if (pageResult.isErr()) {
      return Err({ type: 'page-creation-failed', error: pageResult.error });
    }

    const navigateResult = await this._navigate(pageResult.value, url);
    if (navigateResult.isErr()) {
      return Err({ type: 'navigation-failed', error: navigateResult.error });
    }

    const pageLoadResult = await this._waitForPageLoad(pageResult.value);
    if (pageLoadResult.isErr()) {
      return Err({ type: 'page-failed-to-load', error: pageLoadResult.error });
    }

    await this._finalizePage(pageResult.value);
    return Ok(pageResult.value);
  }

  async screenshot(
    server: Server,
    url: string,
    options: RendererOptions,
  ): Promise<Result<Uint8Array, RendererError>> {
    let page: Page | null = null;
    let screenshot: Uint8Array | null = null;
    try {
      const pageResult = await this._createPage(server, url, options);
      if (pageResult.isErr()) {
        return pageResult;
      }

      page = pageResult.value;

      const screenshotOptions: ScreenshotOptions = {
        type: 'png',
        fullPage: true,
        omitBackground: false,
      };

      screenshot = await page.screenshot(screenshotOptions);
    } catch (error) {
      return Err({ type: 'screenshot-failed', error });
    } finally {
      if (page) {
        try {
          const context = page.browserContext();
          await page.close();
          await context.close();
        } catch {
          // ignore
        }
      }
    }
    return Ok(screenshot);
  }

  async close(): Promise<void> {
    await this.browser.close();
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
    return { state: 'error', message: errorDiv.textContent };
  }

  return false;
}
