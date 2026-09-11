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
    // The consent page now renders multiple submit buttons ("Switch site",
    // "Switch username", and "Allow"), so a bare button[type="submit"] selector
    // resolves to 3 elements and trips Playwright strict mode. Target the Allow
    // button by its stable id, consistent with loginFlow's id-based selectors.
    await this.page.locator('#allow-button').click();
  };
}
