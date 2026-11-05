import { isObject, Json, normalizePythonWhitespace } from './compactYaml.js';
import { AuthoringError, MAX_ITEMS } from './projectIo.js';

function pythonRegexText(value: string): string {
  return normalizePythonWhitespace(
    value.replace(/[İı]/g, 'i').replace(/ſ/g, 's').replace(/K/g, 'k'),
  );
}

export function credentialKind(
  name: unknown,
  nativeSecure = false,
): 'secret' | 'principal' | 'locator' | 'metadata' | 'none' {
  if (typeof name !== 'string' || !name) return 'none';
  const lowered = name.toLowerCase();
  if (nativeSecure || ['password', 'priv-key-file-pwd'].includes(lowered)) return 'secret';
  const parts = name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((p) => p.toLowerCase());
  if (!parts.length) return 'none';
  const tail = (n: number): string => parts.slice(-n).join('/'),
    last = parts[parts.length - 1];
  const has = (...values: string[]): boolean => values.some((v) => parts.includes(v));
  const locator =
    lowered === 'sslfile' ||
    (['file', 'path'].includes(last) &&
      (parts.some(
        (part, i) =>
          ['private', 'priv'].includes(part) &&
          parts[i + 1] === 'key' &&
          ['file', 'path'].includes(parts[i + 2]),
      ) ||
        [
          'ssl/client/key/file',
          'ssl/client/key/path',
          'ssl/client/cert/file',
          'service/account/file/path',
        ].includes(tail(4)) ||
        tail(2) === 'certificate/file'));
  if (locator && !has('password', 'passwd', 'pwd', 'passphrase', 'secret')) return 'locator';
  const label = ['endpoint', 'url', 'uri', 'type', 'mode', 'name'].includes(last);
  if (
    (parts.includes('token') &&
      label &&
      !(parts.includes('personal') && parts.includes('access'))) ||
    ['oauth', 'authentication', 'authentication_mode', 'authentication-mode'].includes(lowered) ||
    (has('auth', 'authentication', 'authorization') && label) ||
    (parts[0] === 'sas' && ['url', 'uri'].includes(last)) ||
    tail(3) === 'workgroup/credentials/dialog'
  )
    return 'metadata';
  if (!AUTH_ATTRIBUTE.test(pythonRegexText(name))) return 'none';
  if (
    ['username', 'userid', 'uid', 'user', 'viewerid'].includes(last) ||
    [
      'user/name',
      'user/id',
      'user/luid',
      'user/custom',
      'client/id',
      'key/id',
      'viewer/id',
      'device/id',
      'authenticated/user',
      'proxy/user',
      'proxy/uid',
      'username/alias',
      'credential/id',
    ].includes(tail(2)) ||
    tail(3) === 'access/key/id'
  )
    return 'principal';
  return 'secret';
}
export const containsInlineCredential = (value: unknown): boolean =>
  typeof value === 'string' &&
  (INLINE_AUTH.test(pythonRegexText(value)) || INLINE_PAIR_AUTH.test(pythonRegexText(value)));
const authContainers = new Set([
  'attributes',
  'connectionAttributes',
  'modifiedConnectionAttributes',
  'headers',
  'setupParameters',
  'executionParameters',
]);
const allowedProviders = new Set([
  'textscan',
  'excel-direct',
  'hyper',
  'json',
  'stat-direct',
  'dataengine',
  'sqlproxy',
  'tableau',
  'tableauserver',
]);
function populated(value: Json): boolean {
  return (
    value !== null &&
    value !== '' &&
    value !== false &&
    value !== 0 &&
    value !== 0n &&
    !(Array.isArray(value) && !value.length) &&
    !(isObject(value) && !Object.keys(value).length)
  );
}
export function scopeCheck(document: Json): void {
  const stack: [Json, boolean][] = [[document, false]];
  let budget = MAX_ITEMS;
  while (stack.length) {
    if (--budget < 0) throw new AuthoringError();
    const [value, auth] = stack.pop()!;
    if (Array.isArray(value)) stack.push(...value.map((v) => [v, auth] as [Json, boolean]));
    else if (isObject(value))
      for (const [key, child] of Object.entries(value)) {
        const kind = credentialKind(key);
        if ((kind === 'secret' || (auth && kind === 'principal')) && populated(child))
          throw new AuthoringError('CREDENTIAL_METADATA_UNSUPPORTED');
        if (
          ['connectionAttributes', 'modifiedConnectionAttributes'].includes(key) &&
          isObject(child) &&
          child.class !== undefined &&
          child.class !== null &&
          !allowedProviders.has(String(child.class))
        )
          throw new AuthoringError('DATABASE_PROVIDER_UNSUPPORTED');
        if (['query', 'sql', 'customSql'].includes(key) && child !== null && child !== '')
          throw new AuthoringError('DATABASE_PROVIDER_UNSUPPORTED');
        stack.push([child, auth || authContainers.has(key)]);
      }
    else if (containsInlineCredential(value))
      throw new AuthoringError('CREDENTIAL_METADATA_UNSUPPORTED');
  }
}

// Exact ECMAScript-compatible classifiers from the reference Python policy.
const AUTH_ATTRIBUTE = new RegExp(
  'password|passwd|passphrase|secret|credential(?!s?[-_.:]?dialog(?:$|[-_.:]))s?|keychain|authorization(?![-_.:]?(?:endpoint|url|uri|name|type|mode)(?:$|[-_.:]))|bearer|(?:^|[-_.:])(?:auth|cookie|signature)$|auth[-_.:]?token(?![-_.:]?(?:endpoint|url|uri|name|type|mode)(?:$|[-_.:]))|(?:account|access|subscription|functions?)[-_.:]?key|shared[-_.:]?access[-_.:]?signature|(?:^|[-_.:])pwd(?:$|[-_.:])|api[-_.:]?key|client[-_.:]?secret|service[-_.:]?account[-_.:]?json|ssl[-_.:]?client[-_.:]?key(?![-_.:]?(?:file|path)(?:$|[-_.:]))|personal[-_.:]?access[-_.:]?token|(?:authentication|authenticity|api|oauth|sas|xsrf)[-_.:]?token(?![-_.:]?(?:endpoint|url|uri|name|type|mode)(?:$|[-_.:]))|(?:access|refresh|id|session|security)[-_.:]?token(?![-_.:]?(?:endpoint|url|uri|name|type|mode)(?:$|[-_.:]))|(?:^|[-_.:])token(?:$|[-_.:](?!(?:endpoint|url|uri|name|type|mode)(?:$|[-_.:])))|(?:private|priv)[-_.:]?key(?![-_.:]?(?:file|path)(?:$|[-_.:]))|client[-_.:]?id$|access[-_.:]?key[-_.:]?id$|(?:^|[-_.:])key[-_.:]?id$|username(?:[-_.:]?alias)?$|userid$|user[-_.:]?(?:name|id|luid|custom)$|viewer[-_.:]?id$|device[-_.:]?id$|authenticated[-_.:]?user$|proxy[-_.:]?(?:user|uid)$|(?:^|[-_.:])(?:user|uid)$',
  'i',
);
const INLINE_AUTH = new RegExp(
  '(?:^|[;?&#,\\s{[(])[\'\\"]?(?:pwd|password|passwd|passphrase|token|access[-_]?token|refresh[-_]?token|id[-_]?token|session[-_]?token|security[-_]?token|authentication[-_]?token|api[-_]?token|oauth[-_]?token|sas[-_]?token|personal[-_]?access[-_]?token|client[-_]?secret|credential|api[-_]?key|x[-_]?api[-_]?key|private[-_]?key|authorization|service[-_]?account[-_]?json|ssl[-_]?client[-_]?key|account[-_]?key|secret[-_]?access[-_]?key|shared[-_]?access[-_]?signature|[A-Za-z0-9]*(?:access[-_]?key[-_]?id|account[-_]?key|secret[-_]?access[-_]?key|session[-_]?token|security[-_]?token|shared[-_]?access[-_]?signature)|x[-_]?tableau[-_]?auth|cookie|set[-_]?cookie|user(?:name|[-_\\s]?id)?|uid|signature|sig)\\s*[\'\\"]?\\s*[:=]|(?:^|[\\s;,])(?:authorization\\s*[:=]\\s*)?(?:basic|bearer)\\s+[^\\s;,]+|://[^/\\s?#@]*@|-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----',
  'i',
);
const INLINE_PAIR_AUTH = new RegExp(
  '(?:^|[;?&#,\\s{[(])[\'\\"]?[A-Za-z0-9_.:-]{0,256}(?:password|passwd|passphrase|secret|credential|keychain|bearer|authorization(?![-_.:]?(?:endpoint|url|uri|name|type|mode)(?=[\'\\"]?\\s*[:=]|[-_.:]))|(?:^|[-_.:])(?:auth|cookie|signature)(?=[\'\\"]?\\s*[:=])|(?:account|access|subscription|functions?)[-_.:]?key|shared[-_.:]?access[-_.:]?signature|(?:^|[-_.:])pwd(?:$|[-_.:])|api[-_.:]?key|client[-_.:]?secret|service[-_.:]?account[-_.:]?json|ssl[-_.:]?client[-_.:]?key(?![-_.:]?(?:file|path)(?=[\'\\"]?\\s*[:=]|[-_.:]))|personal[-_.:]?access[-_.:]?token|(?:authentication|authenticity|api|oauth|sas|xsrf)[-_.:]?token(?![-_.:]?(?:endpoint|url|uri|name|type|mode)(?=[\'\\"]?\\s*[:=]|[-_.:]))|(?:access|refresh|id|session|security)[-_.:]?token(?![-_.:]?(?:endpoint|url|uri|name|type|mode)(?=[\'\\"]?\\s*[:=]|[-_.:]))|(?:^|[-_.:])token(?=[\'\\"]?\\s*[:=]|[-_.:](?!(?:endpoint|url|uri|name|type|mode)(?=[\'\\"]?\\s*[:=]|[-_.:])))|(?:private|priv)[-_.:]?key(?![-_.:]?(?:file|path)(?=[\'\\"]?\\s*[:=]|[-_.:]))|client[-_.:]?id|access[-_.:]?key[-_.:]?id|(?:^|[-_.:])key[-_.:]?id|username(?:[-_.:]?alias)?|userid|user[-_.:]?(?:name|id|luid|custom)|viewer[-_.:]?id|device[-_.:]?id|authenticated[-_.:]?user|proxy[-_.:]?(?:user|uid)|(?:^|[-_.:])(?:user|uid)(?:$|[-_.:]))[A-Za-z0-9_.:-]{0,256}[\'\\"]?\\s*[:=]',
  'i',
);

export const credentialKey = (name: unknown): boolean =>
  ['secret', 'principal'].includes(credentialKind(name));
export function connectionScopeHasCredentials(value: Json, limit = MAX_ITEMS): boolean {
  const pending: Json[] = [value];
  let count = 0;
  while (pending.length) {
    if (++count > limit) return true;
    const current = pending.pop()!;
    if (isObject(current))
      for (const [key, item] of Object.entries(current)) {
        if (
          credentialKey(key) &&
          item !== null &&
          item !== '' &&
          item !== false &&
          item !== 0 &&
          item !== 0n
        )
          return true;
        if (containsInlineCredential(item)) return true;
        if (isObject(item) || Array.isArray(item)) pending.push(item);
      }
    else if (Array.isArray(current))
      pending.push(...current.filter((item) => isObject(item) || Array.isArray(item)));
    else if (containsInlineCredential(current)) return true;
  }
  return false;
}
