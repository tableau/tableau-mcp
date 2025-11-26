import { Resolver } from 'dns/promises';

export const dnsResolver = new Resolver();
dnsResolver.setServers(['1.1.1.1']); // Use Cloudflare public DNS
