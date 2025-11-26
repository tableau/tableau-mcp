import { Resolver } from 'dns/promises';

import { getConfig } from '../../config.js';

let dnsResolver: Resolver | null = null;

export function getDnsResolver(): Resolver {
  if (!dnsResolver) {
    dnsResolver = new Resolver();
    dnsResolver.setServers(getConfig().oauth.dnsServers);
  }

  return dnsResolver;
}
