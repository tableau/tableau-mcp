/**
 * Validation rule: undeclared-encoding-column-instance
 *
 * Tableau can silently drop a Marks-card encoding whose canonical column reference
 * has no matching column-instance declaration in its datasource-dependencies block.
 * Shelves are intentionally excluded because Desktop can derive some shelf instances.
 */
import { parseCanonicalColumnRef } from '../../metadata/field-resolver.js';
import type { ValidationIssue, ValidationRule } from '../types.js';

const DEPENDENCIES = /<datasource-dependencies\b([^>]*)>([\s\S]*?)<\/datasource-dependencies\s*>/gi;
const ENCODINGS = /<encodings\b[^>]*>([\s\S]*?)<\/encodings\s*>/gi;
const COLUMN_TAG = /<[A-Za-z][^>]*\bcolumn\s*=\s*(?:'([^']*)'|"([^"]*)")[^>]*>/gi;
const COLUMN_INSTANCE_TAG = /<column-instance\b[^>]*>/gi;

function attribute(tag: string, name: string): string {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:'([^']*)'|"([^"]*)")`, 'i').exec(tag);
  return match ? (match[1] ?? match[2] ?? '') : '';
}

function declarationKey(datasource: string, instance: string): string {
  return `${datasource.toLowerCase()}::${instance.toLowerCase()}`;
}

export const undeclaredEncodingColumnInstanceRule: ValidationRule = {
  id: 'undeclared-encoding-column-instance',
  description:
    'Errors when a canonical Marks-card encoding reference has no matching column-instance declaration in its datasource.',
  contexts: ['workbook', 'worksheet'],

  validate(xml: string): ValidationIssue[] {
    const source = String(xml ?? '');
    const declared = new Set<string>();

    for (const dependencies of source.matchAll(DEPENDENCIES)) {
      const datasource = attribute(dependencies[1], 'datasource');
      if (!datasource) continue;
      for (const instanceTag of dependencies[2].matchAll(COLUMN_INSTANCE_TAG)) {
        const name = attribute(instanceTag[0], 'name');
        if (name) declared.add(declarationKey(datasource, name));
      }
    }

    const issues: ValidationIssue[] = [];
    const issued = new Set<string>();
    for (const encodings of source.matchAll(ENCODINGS)) {
      for (const encoding of encodings[1].matchAll(COLUMN_TAG)) {
        const columnRef = encoding[1] ?? encoding[2] ?? '';
        const parsed = parseCanonicalColumnRef(columnRef);
        if (!parsed) continue;

        const key = declarationKey(parsed.datasource, parsed.columnInstanceName);
        if (declared.has(key) || issued.has(key)) continue;
        issued.add(key);
        issues.push({
          ruleId: 'undeclared-encoding-column-instance',
          severity: 'error',
          message:
            `Encoding reference ${columnRef} has no matching ` +
            `<column-instance name="${parsed.columnInstanceName}"> in datasource-dependencies ` +
            `for "${parsed.datasource}"; Desktop may silently drop the encoding.`,
          xpath: `//encodings/*[@column='${columnRef}']`,
          suggestion:
            `Declare ${parsed.columnInstanceName} in the "${parsed.datasource}" ` +
            'datasource-dependencies block before applying the worksheet.',
        });
      }
    }

    return issues;
  },
};
