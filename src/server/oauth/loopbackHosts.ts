// Node's URL parser keeps IPv6 hostnames bracketed (e.g. '[::1]').
export const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]', 'localhost']);
