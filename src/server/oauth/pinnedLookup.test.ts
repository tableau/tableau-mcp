import dns from 'dns';
import { LookupFunction } from 'net';

import { createPinnedLookup } from './pinnedLookup.js';

describe('createPinnedLookup', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves the hostname to the pinned address', async () => {
    const lookup = createPinnedLookup('cimd.test', '192.0.2.1') as LookupFunction;
    const callback = vi.fn();

    lookup('cimd.test', {}, callback);

    await new Promise((resolve) => process.nextTick(resolve));
    expect(callback).toHaveBeenCalledWith(null, '192.0.2.1', 4);
  });

  it('resolves the hostname to only the pinned address when all addresses are requested', async () => {
    const lookup = createPinnedLookup('cimd.test', '192.0.2.1') as LookupFunction;
    const callback = vi.fn();

    lookup('cimd.test', { all: true }, callback);

    await new Promise((resolve) => process.nextTick(resolve));
    expect(callback).toHaveBeenCalledWith(null, [{ address: '192.0.2.1', family: 4 }]);
  });

  it('resolves the hostname to a pinned IPv6 address', async () => {
    const lookup = createPinnedLookup('cimd.test', '2001:db8::1') as LookupFunction;
    const callback = vi.fn();

    lookup('cimd.test', { all: true }, callback);

    await new Promise((resolve) => process.nextTick(resolve));
    expect(callback).toHaveBeenCalledWith(null, [{ address: '2001:db8::1', family: 6 }]);
  });

  it('calls back asynchronously like dns.lookup', async () => {
    const lookup = createPinnedLookup('cimd.test', '192.0.2.1') as LookupFunction;
    const callback = vi.fn();

    lookup('cimd.test', {}, callback);
    lookup('cimd.test', { all: true }, callback);

    expect(callback).not.toHaveBeenCalled();
    await new Promise((resolve) => process.nextTick(resolve));
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it('resolves other hostnames with dns.lookup', () => {
    const dnsLookup = vi.spyOn(dns, 'lookup').mockImplementation(() => {});
    const lookup = createPinnedLookup('cimd.test', '192.0.2.1') as LookupFunction;
    const options = { all: true };
    const callback = vi.fn();

    lookup('proxy.test', options, callback);

    expect(dnsLookup).toHaveBeenCalledWith('proxy.test', options, callback);
    expect(callback).not.toHaveBeenCalled();
  });
});
