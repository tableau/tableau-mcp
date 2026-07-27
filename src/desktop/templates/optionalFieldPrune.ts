import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

export interface OptionalFieldPruneSpec {
  templateField: string;
  derivation: string;
  /** Authored column-instance suffix(es); categorical templates may be nominal or ordinal. */
  role: string | string[];
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

function roles(spec: OptionalFieldPruneSpec): string[] {
  return Array.isArray(spec.role) ? spec.role : [spec.role];
}

/**
 * Remove unbound optional template fields that are safe to omit structurally.
 *
 * This is intentionally narrow: callers pass only manifest-approved optional geo LOD
 * or categorical detail slots, and this helper removes exactly their LOD pill, matching
 * column-instance, and base column declaration before normal field-reference rewriting.
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
    const instanceNames = roles(spec).map(
      (role) => `[${spec.derivation}:${spec.templateField}:${role}]`,
    );
    const qualifiedSuffixes = instanceNames.map((instanceName) => `].${instanceName}`);

    for (const lod of elementsByTag(doc, 'lod')) {
      if (
        qualifiedSuffixes.some((qualifiedSuffix) =>
          lod.getAttribute('column')?.endsWith(qualifiedSuffix),
        )
      ) {
        removeElement(lod);
      }
    }

    for (const columnInstance of elementsByTag(doc, 'column-instance')) {
      if (
        columnInstance.getAttribute('column') === baseColumn &&
        instanceNames.includes(columnInstance.getAttribute('name') ?? '')
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
