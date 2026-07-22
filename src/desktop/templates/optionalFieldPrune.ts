import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

export interface OptionalFieldPruneSpec {
  templateField: string;
  derivation: string;
  role: string;
}

const ELEMENT_NODE = 1;

function elementsByTag(doc: Document, tagName: string): Element[] {
  return Array.from(doc.getElementsByTagName(tagName)).filter(
    (node): node is Element => node.nodeType === ELEMENT_NODE,
  );
}

function removeElement(element: Element): void {
  element.parentNode?.removeChild(element);
}

function qualifiedInstanceSuffix(spec: OptionalFieldPruneSpec): string {
  return `].[${spec.derivation}:${spec.templateField}:${spec.role}]`;
}

/**
 * Remove unbound optional template fields that are safe to omit structurally.
 *
 * This is intentionally narrow: callers pass only manifest-approved optional geo LOD
 * slots, and this helper removes exactly their LOD pill, matching column-instance,
 * and base column declaration before the normal field-reference rewrite runs.
 */
export function pruneUnboundOptionalFields(
  templateXml: string,
  specs: OptionalFieldPruneSpec[] = [],
): string {
  if (specs.length === 0) return templateXml;

  const parser = new DOMParser({ errorHandler: (): void => {} });
  const doc = parser.parseFromString(templateXml, 'text/xml') as unknown as Document;

  for (const spec of specs) {
    const baseColumn = `[${spec.templateField}]`;
    const instanceName = `[${spec.derivation}:${spec.templateField}:${spec.role}]`;
    const qualifiedSuffix = qualifiedInstanceSuffix(spec);

    for (const lod of elementsByTag(doc, 'lod')) {
      if (lod.getAttribute('column')?.endsWith(qualifiedSuffix)) {
        removeElement(lod);
      }
    }

    for (const columnInstance of elementsByTag(doc, 'column-instance')) {
      if (
        columnInstance.getAttribute('column') === baseColumn &&
        columnInstance.getAttribute('name') === instanceName
      ) {
        removeElement(columnInstance);
      }
    }

    for (const column of elementsByTag(doc, 'column')) {
      if (column.getAttribute('name') === baseColumn) {
        removeElement(column);
      }
    }
  }

  return new XMLSerializer().serializeToString(doc as any);
}
