import { DOMParser, Element as XmlElement, XMLSerializer } from '@xmldom/xmldom';

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
    if (w && w.getAttribute('class') === 'dashboard' && w.getAttribute('name') === dashboardName) {
      dashboardWindow = w;
      break;
    }
  }

  if (!dashboardWindow) {
    return workbookXml;
  }

  // Remove any existing <viewpoints> child
  const existing = dashboardWindow.getElementsByTagName('viewpoints');
  for (let i = existing.length - 1; i >= 0; i--) {
    const node = existing.item(i);
    if (node && node.parentNode === dashboardWindow) {
      dashboardWindow.removeChild(node);
    }
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
  dashboardWindow.appendChild(viewpointsEl);

  return new XMLSerializer().serializeToString(doc);
}
