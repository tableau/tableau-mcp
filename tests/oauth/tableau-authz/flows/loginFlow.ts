import { Locator } from '@playwright/test';

import { Flow } from './flow.js';

export class LoginFlow extends Flow {
  get usernameTextbox(): Locator {
    return this.page.locator('#email');
  }

  get siteNameTextbox(): Locator {
    return this.page.locator('#site-uri');
  }

  get passwordTextbox(): Locator {
    return this.page.locator('#password');
  }

  get submitUsernameButton(): Locator {
    return this.page.locator('#login-submit');
  }

  get submitSiteNameButton(): Locator {
    return this.page.locator('#verify-button');
  }

  get submitPasswordButton(): Locator {
    return this.page.locator('#signInButton');
  }

  fillUsername = async (username: string): Promise<void> => {
    await this.usernameTextbox.fill(username);
    await this.submitUsernameButton.click();
  };

  fillSiteName = async (siteName: string): Promise<void> => {
    await this.siteNameTextbox.fill(siteName);

    // Sometimes clicking the button doesn't seem to do anything,
    // as if it needs a moment before it can be clicked after entering the site name.
    await this.submitSiteNameButton.waitFor({ state: 'visible' });

    await this.submitSiteNameButton.click();
  };

  fillPassword = async (password: string): Promise<void> => {
    // Do not use fill() because it will appear in the Playwright trace.
    await this.passwordTextbox.evaluate(
      (element: HTMLInputElement, password: string) => (element.value = password),
      password,
    );
    await this.submitPasswordButton.evaluate((element: HTMLButtonElement) => element.click());
  };

  fill = async ({
    username,
    password,
    siteName,
    fillSiteName = false,
  }: {
    username: string;
    password: string;
    siteName: string;
    fillSiteName: boolean;
  }): Promise<void> => {
    await this.fillUsername(username);

    if (fillSiteName) {
      // Looks like users who can only access a single site are not prompted to select a site.
      // Set FILL_SITE_NAME to true if you are running this locally and are prompted to select the site.
      await this.fillSiteName(siteName);
    }

    await this.fillPassword(password);
  };
}
