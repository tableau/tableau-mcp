import { Flow } from './flow';

export class ConsentFlow extends Flow {
  grantConsentIfNecessary = async (): Promise<void> => {
    if (await this.needsConsent()) {
      await this.fill();
    }
  };

  private needsConsent = async (): Promise<boolean> => {
    const pageHeader = this.page.getByText('Consent required');
    const isVisible = await pageHeader
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);

    return isVisible;
  };

  private fill = async (): Promise<void> => {
    const scopeCheckboxes = await this.page.locator('input[name="scope"]').all();
    for (const scopeCheckbox of scopeCheckboxes) {
      await scopeCheckbox.click();
    }

    await this.page.locator('button[type="submit"]').click();
  };
}
