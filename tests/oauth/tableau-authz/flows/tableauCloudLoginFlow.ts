import { Locator } from '@playwright/test';

import { Flow } from './flow';

export class TableauCloudLoginFlow extends Flow {
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
    await this.submitSiteNameButton.click();
  };

  fillPassword = async (password: string): Promise<void> => {
    await this.passwordTextbox.fill(password);
    await this.submitPasswordButton.click();
  };

  fill = async ({
    username,
    password,
    siteName,
  }: {
    username: string;
    password: string;
    siteName: string;
  }): Promise<void> => {
    await this.fillUsername(username);
    await this.fillSiteName(siteName);
    await this.fillPassword(password);
  };
}
