const CREDENTIAL_ATTRIBUTE_NAMES = new Set([
  'accesstoken',
  'apikey',
  'authtoken',
  'bearertoken',
  'clientsecret',
  'credential',
  'idtoken',
  'oauthaccesstoken',
  'passphrase',
  'passwd',
  'password',
  'privatekey',
  'pwd',
  'refreshtoken',
  'secret',
  'secretaccesskey',
  'secretkey',
  'secrettoken',
  'token',
]);

const CREDENTIAL_NAME_SUFFIXES = [...CREDENTIAL_ATTRIBUTE_NAMES];
const ATTRIBUTE_PARAMETER = /(?:^|[?&;])\s*([^?=&#;\s]+)\s*=\s*([^&#;\s]*)/g;
const XML_TAG = /<(?:[^"'<>]|"[^"]*"|'[^']*')*>/g;
const XML_ATTRIBUTE = /(?<!\s)(\s+)([^\s=/>]+)(\s*=\s*)(["'])([\s\S]*?)\4/g;
const CONNECTION_TAG = /^<(?:[\w.-]*[:.])?(?:named-)?connection(?=[\s/>])/;

export const REDACTED_CREDENTIAL_SENTINEL = '__TABLEAU_MCP_REDACTED_CREDENTIAL__';

export function containsRedactedCredentialSentinel(xml: string): boolean {
  return xml.includes(REDACTED_CREDENTIAL_SENTINEL);
}

function normalizeAttributeName(name: string): string {
  let decoded = name;
  try {
    decoded = decodeURIComponent(name.replace(/\+/g, ' '));
  } catch {
    // Malformed percent escapes cannot hide punctuation removed below.
  }
  return decoded.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
}

function isCredentialAttribute(name: string): boolean {
  const normalized = normalizeAttributeName(name);
  return (
    CREDENTIAL_ATTRIBUTE_NAMES.has(normalized) ||
    CREDENTIAL_NAME_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
  );
}

function containsCredentialParameter(value: string): boolean {
  for (const match of value.matchAll(ATTRIBUTE_PARAMETER)) {
    if (isCredentialAttribute(match[1] ?? '') && (match[2] ?? '').trim() !== '') {
      return true;
    }
  }
  return false;
}

/**
 * Replaces credential attribute values on <connection> and <named-connection> tags with
 * REDACTED_CREDENTIAL_SENTINEL, without parsing and reserializing the document. Formulas, captions,
 * names and SQL are never touched. Tableau Desktop normally omits these values, but the MCP boundary
 * must fail safe if an older or regressed host includes one. A redacted copy must never be applied
 * back: runApplyPreamble refuses XML that carries the sentinel.
 */
export function redactDatasourceCredentials(xml: string): string {
  return xml.replace(XML_TAG, (tag) => {
    if (!CONNECTION_TAG.test(tag)) {
      return tag;
    }

    return tag.replace(
      XML_ATTRIBUTE,
      (
        attribute,
        whitespace: string,
        name: string,
        equals: string,
        quote: string,
        value: string,
      ) =>
        (isCredentialAttribute(name) || containsCredentialParameter(value)) && value.trim() !== ''
          ? `${whitespace}${name}${equals}${quote}${REDACTED_CREDENTIAL_SENTINEL}${quote}`
          : attribute,
    );
  });
}
