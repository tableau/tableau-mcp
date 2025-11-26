import { Resolver } from 'dns/promises';

let dnsResolver: Resolver | null = null;

export function getDnsResolver(): Resolver {
  if (!dnsResolver) {
    dnsResolver = new Resolver();
    dnsResolver.setServers(['1.1.1.1']); // Use Cloudflare public DNS
  }

  return dnsResolver;
}
