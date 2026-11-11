import pkg from '../../../package.json';
import { buildDesktopUserAgent, parseUserAgentPrefix } from './userAgent.js';

describe('parseUserAgentPrefix', () => {
  it.each(['tableau-agent/0.27.1234', 'tableau-agent', 'tableau-agent/0.27.1+build.5'])(
    'accepts the product token %s',
    (value) => {
      expect(parseUserAgentPrefix(value)).toBe(value);
    },
  );

  it('trims surrounding whitespace', () => {
    expect(parseUserAgentPrefix('  tableau-agent/1.2.3\n')).toBe('tableau-agent/1.2.3');
  });

  it.each([
    undefined,
    '',
    '   ',
    'tableau-agent/1.0 extra/2.0',
    'tableau-agent/1.0 (comment)',
    'tableau-agent/',
    '/1.0',
    'tableau-agent/1.0/2.0',
    'tableau agent/1.0',
    'tableau-agent/1.0\r\nX-Injected: 1',
    'tableau-agent/ünï',
  ])('ignores %j because it is not a single product token', (value) => {
    expect(parseUserAgentPrefix(value)).toBeUndefined();
  });
});

describe('buildDesktopUserAgent', () => {
  const own = `tableau-desktop-mcp/${pkg.version}`;

  it('identifies this server when the launcher supplies no prefix', () => {
    expect(buildDesktopUserAgent()).toBe(own);
  });

  it('puts the launcher prefix first so Desktop attributes the call to it', () => {
    expect(buildDesktopUserAgent('tableau-agent/0.27.1234')).toBe(`tableau-agent/0.27.1234 ${own}`);
  });
});
