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
