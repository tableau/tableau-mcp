'use strict';

/**
 * Identity-provider hosts for browser MCP. Navigate is always deny.
 * Distinct from other denies (Slack, vaults, cloud consoles).
 */

const SESSION_PRIMING_REQUIRED = 'Session Priming Required';

const IDP_HOSTS = new Set([
  'login.microsoftonline.com',
  'accounts.google.com',
  'login.salesforce.com',
]);

const IDP_SUFFIXES = ['okta.com', 'auth0.com'];

/**
 * @param {string} host
 * @param {string[]} suffixes
 */
function matchesSuffix(host, suffixes) {
  const h = String(host || '').toLowerCase().replace(/\.$/, '');
  for (const suffix of suffixes) {
    if (!suffix) continue;
    if (h === suffix || h.endsWith(`.${suffix}`)) return true;
  }
  return false;
}

/**
 * @param {string} host
 */
function isIdpHost(host) {
  const h = String(host || '')
    .toLowerCase()
    .replace(/\.$/, '');
  if (!h) return false;
  if (IDP_HOSTS.has(h)) return true;
  return matchesSuffix(h, IDP_SUFFIXES);
}

/**
 * @param {string} host
 */
function sessionPrimingRequiredReason(host) {
  const h = String(host || 'IdP');
  return (
    `${SESSION_PRIMING_REQUIRED}: ${h} is an identity provider. ` +
    'Do not drive login or type passwords. SSO in headed Automations Chrome ' +
    '(Profile 3 clone on :9230), then retry the vendor URL — never put ' +
    'credentials in model context.'
  );
}

module.exports = {
  SESSION_PRIMING_REQUIRED,
  IDP_HOSTS,
  IDP_SUFFIXES,
  isIdpHost,
  sessionPrimingRequiredReason,
};
