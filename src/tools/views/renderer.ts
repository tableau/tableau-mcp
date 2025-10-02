import puppeteer, { Browser, Page, ScreenshotOptions } from 'puppeteer';
import { Err, Ok, Result } from 'ts-results-es';

import { Server } from '../../server.js';
import { getExceptionMessage } from '../../utils/getExceptionMessage.js';

export type RendererOptions = {
  url: string;
  width: number;
  height: number;
};

export class Renderer {
  private browser: Browser;

  constructor(browser: Browser) {
    this.browser = browser;
  }

  private async _setupPageAndContext(options: RendererOptions): Promise<Page> {
    const context = await this.browser.createBrowserContext();
    const page = await context.newPage();

    await page.setViewport({
      width: options.width,
      height: options.height,
    });

    return page;
  }

  private async _waitForPageLoad(page: Page, url: string): Promise<void> {
    try {
      await page.goto(url, { waitUntil: 'networkidle2' });
    } catch (e) {
      throw `Navigation failed: ${e}`;
    }

    try {
      await page.waitForFunction(isPageLoadedAndStable, { timeout: 10000 });
    } catch (e) {
      throw `Page failed to load: ${e}`;
    }
  }
  private async _finalizePage(page: Page): Promise<void> {
    await page.emulateMediaType('screen');
  }

  private async _createPage(server: Server, url: string, options: RendererOptions): Promise<Page> {
    const page = await this._setupPageAndContext(options);
    await this._waitForPageLoad(page, url);
    await this._finalizePage(page);
    return page;
  }

  async screenshot(
    server: Server,
    url: string,
    options: RendererOptions,
  ): Promise<Result<Uint8Array, string>> {
    let page: Page | null = null;
    let screenshot: Uint8Array | null = null;
    try {
      page = await this._createPage(server, url, options);

      const screenshotOptions: ScreenshotOptions = {
        type: 'png',
        fullPage: true,
        omitBackground: false,
      };

      screenshot = await page.screenshot(screenshotOptions);
    } catch (e) {
      return Err(getExceptionMessage(e));
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

export async function createRenderer(): Promise<Renderer> {
  const browser = await puppeteer.launch({
    headless: true,
  });

  return new Renderer(browser);
}

function isPageLoadedAndStable(): boolean {
  const navigationTiming = performance?.getEntriesByType?.('navigation')[0];

  return (
    navigationTiming?.duration > 0 &&
    document?.readyState === 'complete' &&
    !!document.querySelector('div[id="success"]')
  );
}
