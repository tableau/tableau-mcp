import { DOMParser, Element as XmlElement, XMLSerializer } from '@xmldom/xmldom';

import { xmlNamesEqual } from '../../xmlElement.js';

/**
 * Injects viewpoint elements into the dashboard window inside workbook XML.
 * A viewpoint tells Tableau Desktop which worksheets are visible through
 * the dashboard window. Without viewpoints the window renders blank.
 */
export function injectViewpoints(
  workbookXml: string,
  dashboardName: string,
  worksheetNames: string[],
): string {
  const parser = new DOMParser({
    errorHandler: (_level, _msg) => {},
  });
  const doc = parser.parseFromString(workbookXml.trim(), 'text/xml');

  // Find the <window class="dashboard" name="<dashboardName>"> element
  const windows = doc.getElementsByTagName('window');
  let dashboardWindow: XmlElement | null = null;
  for (let i = 0; i < windows.length; i++) {
    const w = windows.item(i);
    if (
      w &&
      w.getAttribute('class') === 'dashboard' &&
      xmlNamesEqual(w.getAttribute('name') ?? '', dashboardName)
    ) {
      dashboardWindow = w;
      break;
    }
  }

  if (!dashboardWindow) {
    let windowsElement = doc.getElementsByTagName('windows').item(0);
    if (!windowsElement) {
      const workbookElement = doc.documentElement;
      if (!workbookElement) return workbookXml;
      windowsElement = doc.createElement('windows');
      workbookElement.appendChild(windowsElement);
    }

    dashboardWindow = doc.createElement('window');
    dashboardWindow.setAttribute('class', 'dashboard');
    dashboardWindow.setAttribute('name', dashboardName);
    dashboardWindow.appendChild(buildViewpoints(doc, worksheetNames));
    const active = doc.createElement('active');
    active.setAttribute('id', '-1');
    dashboardWindow.appendChild(active);
    windowsElement.appendChild(dashboardWindow);

    return new XMLSerializer().serializeToString(doc);
  }

  // Remove any existing <viewpoints> child
  const existing = dashboardWindow.getElementsByTagName('viewpoints');
  for (let i = existing.length - 1; i >= 0; i--) {
    const node = existing.item(i);
    if (node && node.parentNode === dashboardWindow) {
      dashboardWindow.removeChild(node);
    }
  }

  dashboardWindow.appendChild(buildViewpoints(doc, worksheetNames));

  return new XMLSerializer().serializeToString(doc);
}

function buildViewpoints(
  doc: ReturnType<DOMParser['parseFromString']>,
  worksheetNames: string[],
): XmlElement {
  const viewpointsEl = doc.createElement('viewpoints');
  for (const name of worksheetNames) {
    const vp = doc.createElement('viewpoint');
    vp.setAttribute('name', name);
    viewpointsEl.appendChild(vp);
  }
  return viewpointsEl;
}
