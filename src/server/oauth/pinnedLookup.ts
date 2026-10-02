import dns from 'dns';
import { isIP, LookupFunction } from 'net';

import { AxiosRequestConfig } from '../../utils/axios.js';

type AxiosLookup = NonNullable<AxiosRequestConfig['lookup']>;

/**
 * Creates a lookup function for axios that resolves `hostname` to `address`
 * and any other hostname, such as that of a proxy, with dns.lookup.
 */
export function createPinnedLookup(hostname: string, address: string): AxiosLookup {
  const family = isIP(address);
  const lookup: LookupFunction = (lookupHostname, options, callback) => {
    if (lookupHostname !== hostname) {
      dns.lookup(lookupHostname, options, callback);
    } else if (options.all) {
      // Call back asynchronously like dns.lookup, so that connection errors reach the request
      process.nextTick(() => callback(null, [{ address, family }]));
    } else {
      process.nextTick(() => callback(null, address, family));
    }
  };

  // axios types the address family as 4 | 6 instead of number
  return lookup as AxiosLookup;
}
