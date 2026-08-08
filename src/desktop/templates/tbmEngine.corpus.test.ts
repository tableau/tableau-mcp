import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DOMParser } from '@xmldom/xmldom';

import { canonicalShortDerivation } from '../derivations.js';
import { blockingValidationIssues, runValidation } from '../validation/registry.js';
import { bookmarkToTemplateWorkbook, deriveTemplatePass1Eligibility } from './bookmarkTemplate.js';
import { rewriteFieldReferences } from './fieldReferenceRewriter.js';
import { inferBindingDescriptor, inferFromBookmark } from './inferSlots.js';
import { buildInjectedWorkbookXml } from './injectTemplateCore.js';

interface RoleAnchoredRef {
  derivation: string;
  bindingDerivation: string;
  field: string;
  role: 'nk' | 'ok' | 'qk';
  trailing: string;
}

interface EligibleTemplate {
  name: string;
  raw: string;
  xml: string;
  inference: ReturnType<typeof inferFromBookmark>;
  slots: ReturnType<typeof inferBindingDescriptor>['slots'];
}

const TEMPLATE_DIR = join(process.cwd(), 'src', 'desktop', 'data', 'templates');
const EMPTY_WORKBOOK = "<?xml version='1.0'?><workbook><worksheets/><windows/></workbook>";
const FIELD_TOKEN = /^\{\{field_base_[1-9]\d*\}\}$/;

// A template may carry literal ALL-CAPS {{TOKEN}}s the binder fills from a proposal's
// template_parameters (e.g. a bar's {{DIRECTION}}, a date filter's {{DATE_MIN}}/{{DATE_MAX}}).
// The real bind always supplies them; the corpus harness supplies only DATASOURCE, so it must
// discover and fill the rest here or a raw apply trips unsubstituted-template-token. DATASOURCE
// and field_base_* are reserved (filled by the field rewriter) — mirror injectTemplateCore's skip.
function literalTemplateParameters(templateXml: string): Record<string, string> {
  const params: Record<string, string> = { DATASOURCE: 'Unrelated DS' };
  for (const match of templateXml.matchAll(/\{\{([A-Z][A-Z0-9_]*)\}\}/g)) {
    const key = match[1];
    if (key === 'DATASOURCE') continue;
    params[key] = 'x';
  }
  return params;
}
const INSTANCE_PREFIX_WRAPPERS = new Set([
  'cum',
  'diff',
  'fval',
  'pcdf',
  'pcto',
  'rank',
  'pcrk',
  'win',
]);

function parseRoleAnchoredRef(inner: string): RoleAnchoredRef | null {
  const parts = inner.split(':');
  let roleIndex = -1;
  for (let index = parts.length - 1; index >= 1; index--) {
    if (parts[index] === 'nk' || parts[index] === 'ok' || parts[index] === 'qk') {
      roleIndex = index;
      break;
    }
  }
  if (roleIndex < 2) return null;
  const derivation = parts.slice(0, roleIndex - 1).join(':');
  if (!derivation) return null;
  return {
    derivation,
    bindingDerivation: derivation.split(':').at(-1)!,
    field: parts[roleIndex - 1],
    role: parts[roleIndex] as RoleAnchoredRef['role'],
    trailing: parts.slice(roleIndex).join(':'),
  };
}

function qualifiedRefs(xml: string): RoleAnchoredRef[] {
  return [...xml.matchAll(/\[[^\]]+\]\.\[([^\]]+)\]/g)]
    .map((match) => parseRoleAnchoredRef(match[1]))
    .filter((ref): ref is RoleAnchoredRef => ref !== null);
}

function primaryPlacementRefs(xml: string): RoleAnchoredRef[] {
  const document = new DOMParser().parseFromString(xml, 'text/xml');
  const all = (tag: string): Element[] =>
    Array.from(document.getElementsByTagName(tag)) as unknown as Element[];
  const roots = [...all('table'), ...all('window')];
  const placed = (tag: string): Element[] =>
    roots.flatMap((root) =>
      root.tagName === tag
        ? [root]
        : (Array.from(root.getElementsByTagName(tag)) as unknown as Element[]),
    );
  const refs: RoleAnchoredRef[] = [];
  const add = (value: string | null): void => {
    if (!value) return;
    const qualified = qualifiedRefs(value);
    refs.push(...qualified);
    if (
      qualified.length === 0 &&
      value.startsWith('[') &&
      value.endsWith(']') &&
      !value.slice(1, -1).includes('[')
    ) {
      const ref = parseRoleAnchoredRef(value.slice(1, -1));
      if (ref) refs.push(ref);
    }
  };

  for (const tag of ['rows', 'cols', 'mark']) {
    for (const element of placed(tag)) add(element.textContent);
  }
  for (const encodings of placed('encodings')) {
    for (const child of Array.from(encodings.getElementsByTagName('*')) as unknown as Element[]) {
      add(child.getAttribute('column'));
    }
  }
  for (const filter of placed('filter')) add(filter.getAttribute('column'));
  for (const slices of placed('slices')) {
    for (const column of Array.from(
      slices.getElementsByTagName('column'),
    ) as unknown as Element[]) {
      add(column.textContent);
    }
  }
  for (const line of placed('reference-line')) {
    add(line.getAttribute('axis-column'));
    add(line.getAttribute('value-column'));
  }
  for (const title of placed('title')) add(title.textContent);
  for (const label of placed('customized-label')) add(label.textContent);
  return refs;
}

function refShape(ref: RoleAnchoredRef): string {
  return `${ref.derivation}|${ref.trailing}`;
}

function multiset(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function eligibleTemplates(): EligibleTemplate[] {
  return readdirSync(TEMPLATE_DIR)
    .filter((file) => file.endsWith('.tbm'))
    .sort()
    .flatMap((file) => {
      const raw = readFileSync(join(TEMPLATE_DIR, file), 'utf8');
      const inference = inferFromBookmark(raw);
      const converted = bookmarkToTemplateWorkbook(raw, inference);
      if (!deriveTemplatePass1Eligibility(converted).pass1_eligible) return [];
      const name = file.slice(0, -'.tbm'.length);
      return [
        {
          name,
          raw,
          xml: converted.xml,
          inference,
          slots: inferBindingDescriptor(name, inference).slots,
        },
      ];
    });
}

function mappingFor(
  template: EligibleTemplate,
  mode: 'bare' | 'qualified',
): { mapping: Record<string, string>; targetByToken: Map<string, string> } {
  const refs = qualifiedRefs(template.xml);
  const slotsByToken = new Map<string, EligibleTemplate['slots']>();
  for (const slot of template.slots) {
    const slots = slotsByToken.get(slot.template_field) ?? [];
    slots.push(slot);
    slotsByToken.set(slot.template_field, slots);
  }

  const mapping: Record<string, string> = {};
  const targetByToken = new Map<string, string>();
  let fieldNumber = 0;
  for (const [token, slots] of slotsByToken) {
    const target = `Unrelated_Field_${++fieldNumber}`;
    targetByToken.set(token, target);
    const selected = mode === 'bare' ? slots.slice(0, 1) : slots;
    for (const slot of selected) {
      const sourceRef = refs.find(
        (ref) => ref.field === token && ref.bindingDerivation === slot.derivation,
      );
      const role = sourceRef?.role ?? (slot.kind === 'quantitative' ? 'qk' : 'nk');
      const key = mode === 'qualified' ? `${token}@${slot.derivation}` : token;
      mapping[key] = `[Unrelated DS].[${slot.derivation}:${target}:${role}]`;
    }
  }
  return { mapping, targetByToken };
}

function calcColumnIdentities(xml: string): string[] {
  const document = new DOMParser().parseFromString(xml, 'text/xml');
  return Array.from(document.getElementsByTagName('column'))
    .filter((column) => column.getElementsByTagName('calculation').length > 0)
    .map((column) => column.getAttribute('name')?.match(/^\[([^\]]+)\]$/)?.[1])
    .filter((name): name is string => !!name);
}

describe('TBM engine corpus invariants', { timeout: 30_000 }, () => {
  let corpus: EligibleTemplate[];

  beforeAll(() => {
    corpus = eligibleTemplates();
  }, 30_000);

  it('classifies every authored primary derivation as bindable or explicitly template-owned', () => {
    const failures: string[] = [];

    for (const template of corpus) {
      const document = new DOMParser().parseFromString(template.raw, 'text/xml');
      const columnDefs = new Map(
        (Array.from(document.getElementsByTagName('column')) as unknown as Element[])
          .map((column) => {
            const base = column.getAttribute('name')?.match(/^\[([^\]]+)\]$/)?.[1];
            return base ? ([base, column] as const) : null;
          })
          .filter((entry): entry is readonly [string, Element] => entry !== null),
      );

      for (const ref of primaryPlacementRefs(template.raw)) {
        const nonWrappers = ref.derivation
          .split(':')
          .filter((prefix) => !INSTANCE_PREFIX_WRAPPERS.has(prefix.toLowerCase()));
        const canonical = canonicalShortDerivation(ref.derivation);
        if (!canonical || nonWrappers.length !== 1) {
          failures.push(
            `${template.name}:${ref.derivation}:${ref.field} has no single canonical binding derivation`,
          );
          continue;
        }

        const definition = columnDefs.get(ref.field);
        const templateOwned =
          definition === undefined ||
          definition.getElementsByTagName('calculation').length > 0 ||
          definition.getAttribute('datatype') === 'spatial' ||
          canonical === 'io' ||
          canonical === 'clct';
        if (templateOwned) continue;

        if (
          !template.inference.slots.some(
            (slot) => slot.sourceField === ref.field && slot.derivation === canonical,
          )
        ) {
          failures.push(
            `${template.name}:${ref.derivation}:${ref.field} is neither targetable nor template-owned`,
          );
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it('keeps namespace declarations required by converted bookmark fragments', () => {
    const failures: string[] = [];

    for (const template of corpus) {
      const usedPrefixes = new Set(
        [...template.xml.matchAll(/\s([A-Za-z_][\w.-]*):[A-Za-z_][\w.-]*=/g)]
          .map((match) => match[1])
          .filter((prefix) => prefix !== 'xmlns'),
      );
      for (const prefix of usedPrefixes) {
        if (!new RegExp(`\\sxmlns:${prefix}=`).test(template.xml)) {
          failures.push(`${template.name}: missing xmlns:${prefix}`);
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it.each(['bare', 'qualified'] as const)(
    '%s mappings preserve secondary derivations while changing every mapped base field',
    (mode) => {
      const templates = corpus;
      const secondaryShapes = new Set<string>();
      const failures: string[] = [];

      for (const template of templates) {
        const originalRefs = qualifiedRefs(template.xml).filter((ref) =>
          FIELD_TOKEN.test(ref.field),
        );
        const declaredByToken = new Map<string, Set<string>>();
        for (const slot of template.slots) {
          const derivations = declaredByToken.get(slot.template_field) ?? new Set<string>();
          derivations.add(slot.derivation);
          declaredByToken.set(slot.template_field, derivations);
        }
        for (const ref of originalRefs) {
          if (!declaredByToken.get(ref.field)?.has(ref.bindingDerivation)) {
            secondaryShapes.add(`${template.name}:${ref.field}:${ref.derivation}:${ref.trailing}`);
          }
        }

        const { mapping, targetByToken } = mappingFor(template, mode);
        try {
          const rewritten = rewriteFieldReferences(
            template.xml,
            mapping,
            'Unrelated DS',
            undefined,
            {
              templateSlots: template.slots,
            },
          );
          if (/\{\{field_base_[1-9]\d*\}\}/.test(rewritten)) {
            failures.push(`${template.name}: unresolved token residue`);
            continue;
          }
          const rewrittenRefs = qualifiedRefs(rewritten);
          for (const [token, target] of targetByToken) {
            const originalForToken = originalRefs.filter((ref) => ref.field === token);
            const expectedSecondary = multiset(
              originalForToken
                .filter((ref) => !declaredByToken.get(token)?.has(ref.bindingDerivation))
                .map(refShape),
            );
            const actualForTarget = rewrittenRefs.filter((ref) => ref.field === target);
            const actual = multiset(actualForTarget.map(refShape));
            const expectedRoles = multiset(originalForToken.map((ref) => ref.trailing));
            const actualRoles = multiset(actualForTarget.map((ref) => ref.trailing));
            const missingSecondary = Object.entries(expectedSecondary).filter(
              ([shape, count]) => (actual[shape] ?? 0) < count,
            );
            const authoredRoleMismatch =
              Object.entries(expectedRoles).some(([role, count]) => actualRoles[role] !== count) ||
              Object.entries(actualRoles).some(([role, count]) => expectedRoles[role] !== count);
            if (
              actualForTarget.length !== originalForToken.length ||
              missingSecondary.length > 0 ||
              authoredRoleMismatch
            ) {
              failures.push(
                `${template.name}:${token} expected_roles=${JSON.stringify(expectedRoles)} actual_roles=${JSON.stringify(actualRoles)}`,
              );
            }
          }
        } catch (error) {
          failures.push(
            `${template.name}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      expect(
        failures,
        `eligible=${templates.length} secondary_shapes=${secondaryShapes.size}`,
      ).toEqual([]);
    },
  );

  it('carries required namespace declarations through worksheet injection', () => {
    const failures: string[] = [];

    for (const template of corpus.filter((candidate) => /\sxmlns:/.test(candidate.xml))) {
      const { mapping } = mappingFor(template, 'qualified');
      const result = buildInjectedWorkbookXml({
        workbookXml: EMPTY_WORKBOOK,
        templateXml: template.xml,
        title: `Namespace ${template.name}`,
        sheetType: 'worksheet',
        templateParameters: { DATASOURCE: 'Unrelated DS' },
        fieldMapping: mapping,
        templateSlots: template.slots,
        applyNonce: `namespace-${template.name}`,
      });
      if (!result.ok) {
        const namespaceIssues = result.issues.filter((issue) => issue.includes('NamespaceError'));
        if (namespaceIssues.length > 0)
          failures.push(`${template.name}: ${namespaceIssues.join('; ')}`);
      }
    }

    expect(failures).toEqual([]);
  });

  it('namespaces every template calc identity in every bracketed ref after injection', () => {
    const templates = corpus;
    const failures: string[] = [];

    for (const template of templates) {
      const oldCalcNames = calcColumnIdentities(template.xml);
      if (oldCalcNames.length === 0) continue;
      const { mapping } = mappingFor(template, 'qualified');
      try {
        const result = buildInjectedWorkbookXml({
          workbookXml: EMPTY_WORKBOOK,
          templateXml: template.xml,
          title: `Corpus ${template.name}`,
          sheetType: 'worksheet',
          templateParameters: { DATASOURCE: 'Unrelated DS' },
          fieldMapping: mapping,
          templateSlots: template.slots,
          applyNonce: `corpus-${template.name}`,
        });
        if (!result.ok) {
          failures.push(`${template.name}: ${result.issues.join('; ')}`);
          continue;
        }
        const refs = [...result.xml.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1]);
        for (const oldName of oldCalcNames) {
          const survivors = refs.filter((inner) => {
            if (inner === oldName) return true;
            return parseRoleAnchoredRef(inner)?.field === oldName;
          });
          if (survivors.length > 0) {
            failures.push(`${template.name}:${oldName} survived as ${survivors.join(', ')}`);
          }
        }
      } catch (error) {
        failures.push(
          `${template.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    expect(failures, `eligible=${templates.length}`).toEqual([]);
  });

  it('passes every blocking validation rule after binding and worksheet injection', () => {
    const failures: string[] = [];

    for (const template of corpus) {
      const { mapping } = mappingFor(template, 'qualified');
      try {
        const result = buildInjectedWorkbookXml({
          workbookXml: EMPTY_WORKBOOK,
          templateXml: template.xml,
          title: `Validation ${template.name}`,
          sheetType: 'worksheet',
          templateParameters: literalTemplateParameters(template.xml),
          fieldMapping: mapping,
          templateSlots: template.slots,
          applyNonce: `validation-${template.name}`,
        });
        if (!result.ok) {
          failures.push(`${template.name}: injection failed: ${result.issues.join('; ')}`);
          continue;
        }

        for (const issue of blockingValidationIssues(
          runValidation(result.xml, 'workbook').issues,
        )) {
          failures.push(`${template.name}: ${issue.ruleId}: ${issue.message}`);
        }
      } catch (error) {
        failures.push(
          `${template.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    expect(failures, `eligible=${corpus.length}`).toEqual([]);
  });
});
