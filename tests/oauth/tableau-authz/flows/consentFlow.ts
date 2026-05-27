import { Flow } from './flow.js';

export class ConsentFlow extends Flow {
  grantConsentIfNecessary = async (): Promise<void> => {
    if (await this.needsConsent()) {
      await this.fill();
    }
  };

  private needsConsent = async (): Promise<boolean> => {
    const pageHeader = this.page.getByText('requests access to Tableau');
    const isVisible = await pageHeader
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);

    return isVisible;
  };

  private fill = async (): Promise<void> => {
    await this.page.locator('button[type="submit"]').click();
  };
}
