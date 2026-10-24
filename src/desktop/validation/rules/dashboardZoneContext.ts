import * as xpath from 'xpath';

export const CANONICAL_ID = /^(0|[1-9][0-9]*)$/;

export function enclosingDashboard(zone: Element): Element | undefined {
  let node: Node | null = zone.parentNode;
  while (node) {
    if (node.nodeType === 1 && (node as Element).nodeName === 'dashboard') return node as Element;
    node = node.parentNode;
  }
  return undefined;
}

export function enclosingDeviceLayout(zone: Element): Element | undefined {
  let node: Node | null = zone.parentNode;
  while (node) {
    if (node.nodeType === 1 && (node as Element).nodeName === 'devicelayout')
      return node as Element;
    node = node.parentNode;
  }
  return undefined;
}

export function enclosingDeviceLayoutName(zone: Element): string | undefined {
  const layout = enclosingDeviceLayout(zone);
  return layout ? layout.getAttribute('name') || '(unnamed)' : undefined;
}

export function canonicalDigits(id: string): string | undefined {
  const trimmed = id.trim();
  const digits = trimmed.startsWith('+') ? trimmed.slice(1) : trimmed;
  return /^[0-9]+$/.test(digits) ? digits.replace(/^0+(?=[0-9])/, '') : undefined;
}

export function nextFreeId(dashboard: Element | undefined): bigint {
  if (!dashboard) return 1n;
  let max = 0n;
  for (const zone of xpath.select('.//zone[@id]', dashboard as unknown as Node) as Element[]) {
    const canonical = canonicalDigits(zone.getAttribute('id')!);
    if (canonical !== undefined && BigInt(canonical) > max) max = BigInt(canonical);
  }
  return max + 1n;
}
