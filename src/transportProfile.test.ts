import { resolveTransportProfile } from './transportProfile.js';

describe('resolveTransportProfile', () => {
  it('defaults to the desktop profile when TRANSPORT is unset', () => {
    expect(resolveTransportProfile(undefined)).toBe('desktop');
  });

  it('maps stdio to the desktop authoring profile', () => {
    expect(resolveTransportProfile('stdio')).toBe('desktop');
  });

  it('maps http to the web/insights profile', () => {
    expect(resolveTransportProfile('http')).toBe('web');
  });

  it('throws on an invalid transport instead of failing open to the web path', () => {
    expect(() => resolveTransportProfile('htpp')).toThrow(/Unsupported TRANSPORT/);
    expect(() => resolveTransportProfile('sse')).toThrow(/expected "stdio"/);
    expect(() => resolveTransportProfile('')).toThrow(/Unsupported TRANSPORT/);
  });
});
