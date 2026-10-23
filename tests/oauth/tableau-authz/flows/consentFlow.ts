import { Flow } from './flow.js';

export class ConsentFlow extends Flow {
  grantConsentIfNecessary = async (authorizationComplete?: Promise<unknown>): Promise<void> => {
    if (await this.needsConsent(authorizationComplete)) {
      await this.fill();
    }
  };

  private needsConsent = async (authorizationComplete?: Promise<unknown>): Promise<boolean> => {
    const pageHeader = this.page.getByText('requests access to Tableau');
    const isVisible = pageHeader
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);

    return authorizationComplete
      ? await Promise.race([isVisible, authorizationComplete.then(() => false)])
      : await isVisible;
  };

  private fill = async (): Promise<void> => {
    // The consent page has multiple submit buttons (Switch site/username), so target Allow by id.
    await this.page.locator('#allow-button').click();
  };
}
