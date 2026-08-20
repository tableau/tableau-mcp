import { Flow } from './flow.js';

export class ConsentFlow extends Flow {
  grantConsentIfNecessary = async (authorizationComplete: Promise<unknown>): Promise<void> => {
    if (await this.needsConsent(authorizationComplete)) {
      await this.fill();
    }
  };

  private needsConsent = async (authorizationComplete: Promise<unknown>): Promise<boolean> => {
    const pageHeader = this.page.getByText('requests access to Tableau');

    return await Promise.race([
      pageHeader.waitFor({ state: 'visible' }).then(() => true),
      authorizationComplete.then(() => false),
    ]);
  };

  private fill = async (): Promise<void> => {
    await this.page.locator('#allow-button').click();
  };
}
