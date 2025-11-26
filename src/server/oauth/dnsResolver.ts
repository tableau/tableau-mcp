import { Resolver } from 'dns/promises';

const dnsResolver = new Resolver();
dnsResolver.setServers(['1.1.1.1']); // Use Cloudflare public DNS

export function getDnsResolver(): Resolver {
  return dnsResolver;
}
