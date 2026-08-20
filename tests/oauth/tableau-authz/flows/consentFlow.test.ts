import { expect, test } from '@playwright/test';

import { ConsentFlow } from './consentFlow.js';

test('clicks Allow when the consent page has several submit buttons', async ({ page }) => {
  await page.setContent(`
    <h1>An OAuth client requests access to Tableau</h1>
    <form id="relogin_form"></form>
    <button
      id="switch-site-link"
      type="submit"
      name="switchType"
      value="site"
      form="relogin_form"
      onclick="document.body.dataset.action = 'switch-site'"
    >Switch site</button>
    <button
      id="switch-username-link"
      type="submit"
      name="switchType"
      value="username"
      form="relogin_form"
      onclick="document.body.dataset.action = 'switch-username'"
    >Switch username</button>
    <button
      id="allow-button"
      type="submit"
      onclick="document.body.dataset.action = 'allow'"
    >Allow</button>
  `);

  const authorizationPending = new Promise(() => undefined);
  await new ConsentFlow(page).grantConsentIfNecessary(authorizationPending);

  await expect(page.locator('body')).toHaveAttribute('data-action', 'allow');
});
