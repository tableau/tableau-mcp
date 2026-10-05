import { DOMParser, Element as XmlElement, Node as XmlNode } from '@xmldom/xmldom';

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
  const landed = requested.filter((name) => after.has(name));
  const failed = requested.filter((name) => !after.has(name));

  if (failed.length === 0) {
    return {
      state:
        requested.length > 0 &&
        afterXml === beforeXml &&
        requested.every((name) => before.has(name))
          ? 'success-already-present'
          : 'success',
      requested,
      landed,
      failed,
    };
  }

  return { state: 'failed', requested, landed, failed };
}

function dashboardViewpointNames(workbookXml: string, dashboardName: string): Set<string> {
  const parser = new DOMParser({ errorHandler: () => {} });
  const doc = parser.parseFromString(workbookXml.trim(), 'text/xml');
  const windows = doc.getElementsByTagName('window');
  for (let i = 0; i < windows.length; i++) {
    const window = windows.item(i);
    if (
      window &&
      window.getAttribute('class') === 'dashboard' &&
      window.getAttribute('name') === dashboardName
    ) {
      return directViewpointNames(window);
    }
  }
  return new Set();
}

function directViewpointNames(dashboardWindow: XmlElement): Set<string> {
  const names = new Set<string>();
  for (let i = 0; i < dashboardWindow.childNodes.length; i++) {
    const child = dashboardWindow.childNodes.item(i);
    if (!isElementNamed(child, 'viewpoints')) continue;
    for (let j = 0; j < child.childNodes.length; j++) {
      const viewpoint = child.childNodes.item(j);
      if (isElementNamed(viewpoint, 'viewpoint')) {
        const name = viewpoint.getAttribute('name');
        if (name) names.add(name);
      }
    }
  }
  return names;
}

function isElementNamed(node: XmlNode | null, tagName: string): node is XmlElement {
  return node?.nodeType === 1 && (node as XmlElement).tagName === tagName;
}
