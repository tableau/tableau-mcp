/**
 * Validation rule: calc-name-field-collision
 *
 * Naming a calculated field the same as an existing datasource field makes
 * Tableau silently ignore the calc on load. Scope detection to sibling columns
 * so legitimate datasource/dependency duplicate calc declarations are not flagged.
 */
import * as xpath from 'xpath';

import type { ValidationIssue, ValidationRule } from '../types.js';
import { parseXml } from './parseXml.js';

function hasCalculationChild(col: Element): boolean {
  for (let i = 0; i < col.childNodes.length; i += 1) {
    const child = col.childNodes[i] as Element;
    if (child.nodeType === 1 && child.nodeName === 'calculation') return true;
  }
  return false;
}

export const calcNameFieldCollisionRule: ValidationRule = {
  id: 'calc-name-field-collision',
  description:
    "Errors when a calculated field's name/caption collides with an existing datasource " +
    "field; Tableau silently ignores the calc ('already defined by data source') and the viz renders blank.",
  contexts: ['workbook', 'worksheet'],

  validate(xml: string): ValidationIssue[] {
    const doc = parseXml(xml);
    if (!doc) return [];

    const columns = xpath.select('//column', doc as unknown as Node) as Element[];
    const groups = new Map<Node, Element[]>();

    for (const col of columns) {
      const parent = col.parentNode as Node | null;
      if (!parent) continue;
      const siblings = groups.get(parent) ?? [];
      siblings.push(col);
      groups.set(parent, siblings);
    }

    const issues: ValidationIssue[] = [];
    const seen = new Set<string>();

    for (const siblings of groups.values()) {
      const fieldNames = new Set<string>();
      const fieldCaptions = new Set<string>();

      for (const col of siblings) {
        if (hasCalculationChild(col)) continue;
        const name = col.getAttribute('name');
        const caption = col.getAttribute('caption');
        if (name) fieldNames.add(name);
        if (caption) fieldCaptions.add(caption);
      }

      if (fieldNames.size === 0 && fieldCaptions.size === 0) continue;

      for (const col of siblings) {
        if (!hasCalculationChild(col)) continue;
        const name = col.getAttribute('name') ?? '';
        const caption = col.getAttribute('caption') ?? '';
        const nameCollides = name !== '' && fieldNames.has(name);
        const captionCollides = caption !== '' && fieldCaptions.has(caption);
        if (!nameCollides && !captionCollides) continue;

        const collidedOn = nameCollides ? name : caption;
        if (seen.has(collidedOn)) continue;
        seen.add(collidedOn);

        issues.push({
          ruleId: 'calc-name-field-collision',
          severity: 'error',
          message:
            `Calculated field ${nameCollides ? `name "${name}"` : `caption "${caption}"`} collides with an ` +
            `existing datasource field of the same ${nameCollides ? 'name' : 'caption'}. Tableau silently ignores ` +
            'the calc on load ("field is already defined by data source") and the worksheet renders blank/wrong. ' +
            `Give the calc a distinct name (e.g. "${(name || caption).replace(/\]$/, '')} (calc)]"), or reference the ` +
            'existing field directly with no wrapping calc.',
          xpath: `//column[@name="${name}"][calculation]`,
          suggestion:
            'Rename the calc to a name that does not exist in the datasource (e.g. append " (calc)"/" Adjusted"/" Ratio"), ' +
            'or drop the calc and put the existing field on the shelf as-is.',
        });
      }
    }

    return issues;
  },
};
