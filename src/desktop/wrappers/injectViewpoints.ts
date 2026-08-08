import { DOMParser, Element as XmlElement, XMLSerializer } from '@xmldom/xmldom';

import { xmlNamesEqual } from '../xmlElement.js';

/**
 * Injects viewpoint elements into the dashboard window inside workbook XML.
 * A viewpoint tells Tableau Desktop which worksheets are visible through
 * the dashboard window. Without viewpoints the window renders blank.
 *
 * Returns the modified workbook XML string, or the original if the target
 * window is not found (non-fatal — Tableau will still receive the apply).
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
    const windowName = w?.getAttribute('name');
    if (
      w &&
      windowName &&
      w.getAttribute('class') === 'dashboard' &&
      xmlNamesEqual(windowName, dashboardName)
    ) {
      dashboardWindow = w;
      break;
    }
  }

  if (!dashboardWindow) {
    return workbookXml;
  }

  // Build new <viewpoints> element
  const viewpointsEl = doc.createElement('viewpoints');
  for (const name of worksheetNames) {
    const vp = doc.createElement('viewpoint');
    vp.setAttribute('name', name);
    const zoom = doc.createElement('zoom');
    zoom.setAttribute('type', 'entire-view');
    vp.appendChild(zoom);
    viewpointsEl.appendChild(vp);
  }
  const directViewpoints: XmlElement[] = [];
  for (let i = 0; i < dashboardWindow.childNodes.length; i++) {
    const child = dashboardWindow.childNodes.item(i);
    if (!child || child.nodeType !== 1) continue;
    const element = child as XmlElement;
    if (element.tagName === 'viewpoints') directViewpoints.push(element);
  }

  for (const existingViewpoints of directViewpoints) {
    dashboardWindow.removeChild(existingViewpoints);
  }

  const firstDirectElement = directChildElements(dashboardWindow)[0];
  if (firstDirectElement) {
    dashboardWindow.insertBefore(viewpointsEl, firstDirectElement);
  } else {
    dashboardWindow.appendChild(viewpointsEl);
  }

  return new XMLSerializer().serializeToString(doc);
}

function directChildElements(parent: XmlElement): XmlElement[] {
  const elements: XmlElement[] = [];
  for (let index = 0; index < parent.childNodes.length; index++) {
    const child = parent.childNodes.item(index);
    if (child?.nodeType === 1) elements.push(child as XmlElement);
  }
  return elements;
}
