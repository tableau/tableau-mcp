import { DOMParser, Element as XmlElement, Node as XmlNode } from '@xmldom/xmldom';

import { xmlNamesEqual } from '../../../desktop/xmlElement.js';

export type ViewpointAccounting = {
  state: 'success' | 'success-already-present' | 'failed';
  requested: string[];
  landed: string[];
  failed: string[];
};

export function accountDashboardViewpoints({
  beforeXml,
  afterXml,
  dashboardName,
  requested,
}: {
  beforeXml: string;
  afterXml: string;
  dashboardName: string;
  requested: string[];
}): ViewpointAccounting {
  const before = dashboardViewpointNames(beforeXml, dashboardName);
  const after = dashboardViewpointNames(afterXml, dashboardName);
  const landed = requested.filter((name) =>
    after.names.some((viewpointName) => xmlNamesEqual(viewpointName, name)),
  );
  const failed = requested.filter(
    (name) => !after.names.some((viewpointName) => xmlNamesEqual(viewpointName, name)),
  );

  if (failed.length === 0) {
    const alreadyPresent =
      before.windowExists &&
      requested.every((name) =>
        before.names.some((viewpointName) => xmlNamesEqual(viewpointName, name)),
      );
    return {
      state: alreadyPresent ? 'success-already-present' : 'success',
      requested,
      landed,
      failed,
    };
  }

  return { state: 'failed', requested, landed, failed };
}

function dashboardViewpointNames(
  workbookXml: string,
  dashboardName: string,
): { windowExists: boolean; names: string[] } {
  const parser = new DOMParser({ errorHandler: () => {} });
  const doc = parser.parseFromString(workbookXml.trim(), 'text/xml');
  const windows = doc.getElementsByTagName('window');
  for (let i = 0; i < windows.length; i++) {
    const window = windows.item(i);
    if (
      window &&
      window.getAttribute('class') === 'dashboard' &&
      xmlNamesEqual(window.getAttribute('name') ?? '', dashboardName)
    ) {
      return { windowExists: true, names: directViewpointNames(window) };
    }
  }
  return { windowExists: false, names: [] };
}

function directViewpointNames(dashboardWindow: XmlElement): string[] {
  const names: string[] = [];
  for (let i = 0; i < dashboardWindow.childNodes.length; i++) {
    const child = dashboardWindow.childNodes.item(i);
    if (!isElementNamed(child, 'viewpoints')) continue;
    for (let j = 0; j < child.childNodes.length; j++) {
      const viewpoint = child.childNodes.item(j);
      if (isElementNamed(viewpoint, 'viewpoint')) {
        const name = viewpoint.getAttribute('name');
        if (name) names.push(name);
      }
    }
  }
  return names;
}

function isElementNamed(node: XmlNode | null, tagName: string): node is XmlElement {
  return node?.nodeType === 1 && (node as XmlElement).tagName === tagName;
}
