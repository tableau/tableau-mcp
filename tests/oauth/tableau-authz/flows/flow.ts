import { Page } from '@playwright/test';

export abstract class Flow {
  private _page: Page;

  constructor(page: Page) {
    this._page = page;
  }

  protected get page(): Page {
    return this._page;
  }
}
