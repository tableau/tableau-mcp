import { DOMParser, Element as XmlElement } from '@xmldom/xmldom';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { readDataAsset } from '../assets.js';
import { searchWorkbookSchema } from './searchLibrary.js';

const originalWorkbookXsdPath = process.env.WORKBOOK_XSD_PATH;
const originalSchemaReferencePath = process.env.SCHEMA_REFERENCE_PATH;

afterEach(() => {
  if (originalWorkbookXsdPath === undefined) delete process.env.WORKBOOK_XSD_PATH;
  else process.env.WORKBOOK_XSD_PATH = originalWorkbookXsdPath;
  if (originalSchemaReferencePath === undefined) delete process.env.SCHEMA_REFERENCE_PATH;
  else process.env.SCHEMA_REFERENCE_PATH = originalSchemaReferencePath;
  vi.resetModules();
});

describe('searchWorkbookSchema', () => {
  it('returns source XSD grammar and recursively resolves referenced declarations', () => {
    const result = searchWorkbookSchema({
      elementType: 'TabAgentConfig-Item-CT',
      expandRefs: true,
    });

    expect(result.source).toBe('twb_2026.2.0.xsd');
    expect(result.version).toBe('2026.2.0');
    expect(result.elements).toHaveLength(1);
    expect(result.elements[0]).toMatchObject({
      name: 'TabAgentConfig-Item-CT',
      kind: 'complexType',
    });
    expect(result.elements[0].xsd).toContain('<xs:sequence>');
    expect(result.elements[0].xsd).toContain(
      '<xs:element name="excluded-sheets" type="TabAgentConfig-ExcludedSheets-CT" minOccurs="0"/>',
    );
    expect(result.elements[0].expandedRefs['TabAgentConfig-ExcludedSheets-CT'].xsd).toContain(
      '<xs:group ref="SimpleIdentifier-G" maxOccurs="unbounded"/>',
    );
    expect(
      result.elements[0].expandedRefs['TabAgentConfig-ExcludedSheets-CT'].expandedRefs[
        'SimpleIdentifier-G'
      ].xsd,
    ).toContain('<xs:attribute name="uuid" type="QUUID-ST" use="required"/>');
  });

  it('returns non-enumeration value constraints from the XSD', () => {
    const result = searchWorkbookSchema({ enumType: 'ActionList-CommandName-ST' });

    expect(result.enums).toHaveLength(1);
    expect(result.enums[0]).toMatchObject({
      name: 'ActionList-CommandName-ST',
      kind: 'simpleType',
    });
    expect(result.enums[0].xsd).toContain('<xs:pattern value="[^:]+:[^:]+"/>');
  });

  it('preserves legal enumeration tokens from the XSD', () => {
    const result = searchWorkbookSchema({ enumType: 'PrimitiveType-ST' });

    expect(result.enums).toHaveLength(1);
    expect(result.enums[0].xsd).toContain('<xs:enumeration value="GanttBar"/>');
  });

  it('finds the enclosing declaration for a nested element name', () => {
    const result = searchWorkbookSchema({ keywords: ['excluded-sheets'] });

    expect(
      result.elements.some((entry: { name: string }) => entry.name === 'TabAgentConfig-Item-CT'),
    ).toBe(true);
    expect(
      result.elements.find((entry: { name: string }) => entry.name === 'TabAgentConfig-Item-CT')
        .xsd,
    ).toContain('name="excluded-sheets"');
  });

  it('bounds recursive expansion and names declarations that should be queried next', () => {
    const result = searchWorkbookSchema({ elementType: 'DataSource-CT', expandRefs: true });

    expect(Buffer.byteLength(JSON.stringify(result, null, 2))).toBeLessThan(64 * 1024);
    expect(result.elements[0].expansionTruncated).toBe(true);
    expect(result.elements[0].unexpandedRefs.length).toBeGreaterThan(0);
  });

  it('conservatively bounds broad expanded results and names declarations to query next', () => {
    const result = searchWorkbookSchema({ keywords: ['filter'], expandRefs: true });

    expect(Buffer.byteLength(JSON.stringify(result, null, 2))).toBeLessThan(64 * 1024);
    expect(result.responseTruncated).toBe(true);
    expect(result.omittedDeclarations.length).toBeGreaterThan(0);
    expect(result.omittedDeclarations[0]).toMatchObject({
      kind: expect.any(String),
      name: expect.any(String),
    });
    expect(result.responseHint).toContain('Query an omitted declaration by name');
  });

  it('keeps an explicit element match ahead of optional keyword matches', () => {
    const result = searchWorkbookSchema({
      elementType: 'DataSource-CT',
      keywords: ['filter'],
      expandRefs: true,
    });

    expect(result.elements.some((entry: { name: string }) => entry.name === 'DataSource-CT')).toBe(
      true,
    );
    expect(result.omittedDeclarations ?? []).not.toContainEqual(
      expect.objectContaining({ name: 'DataSource-CT' }),
    );
    expect(Buffer.byteLength(JSON.stringify(result, null, 2))).toBeLessThan(64 * 1024);
  });

  it('ranks declaration-name matches ahead of raw-body matches', () => {
    const dataSource = searchWorkbookSchema({ elementType: 'DataSource' });
    const zone = searchWorkbookSchema({ elementType: 'Zone' });

    expect(dataSource.elements[0].name).toBe('DataSource-CT');
    expect(zone.elements[0].name).toBe('Zone-G');
  });

  it('keeps the best broad explicit match and names optional matches omitted for size', () => {
    const result = searchWorkbookSchema({ elementType: 'Field', expandRefs: true });

    expect(result.elements[0].name).toBe('Fields-CT');
    expect(Buffer.byteLength(JSON.stringify(result, null, 2))).toBeLessThan(64 * 1024);
    expect(result.responseTruncated).toBe(true);
    expect(result.omittedDeclarations.length).toBeGreaterThan(0);
    expect(result.omittedDeclarations).not.toContainEqual(
      expect.objectContaining({ name: 'Fields-CT' }),
    );
  });

  it('keeps an exact SetFunction-G lookup below the conservative pretty-printed ceiling', () => {
    const result = searchWorkbookSchema({ elementType: 'SetFunction-G', expandRefs: true });

    expect(result.elements).toHaveLength(1);
    expect(result.elements[0].name).toBe('SetFunction-G');
    expect(result.elements[0].xsd).toContain('<xs:group name="SetFunction-G"');
    expect(Buffer.byteLength(JSON.stringify(result, null, 2))).toBeLessThan(64 * 1024);
  });

  it('keeps SCHEMA_REFERENCE_PATH as a deprecated alias for an XSD path', async () => {
    delete process.env.WORKBOOK_XSD_PATH;
    process.env.SCHEMA_REFERENCE_PATH = path.join(
      process.cwd(),
      'src/desktop/data/twb_2026.2.0.xsd',
    );
    vi.resetModules();

    const { searchWorkbookSchema: isolatedSearch } = await import('./searchLibrary.js');
    expect(isolatedSearch({ enumType: 'PrimitiveType-ST' }).source).toBe('twb_2026.2.0.xsd');
  });

  it('prefers WORKBOOK_XSD_PATH over the deprecated schema path alias', async () => {
    process.env.WORKBOOK_XSD_PATH = path.join(process.cwd(), 'src/desktop/data/twb_2026.2.0.xsd');
    process.env.SCHEMA_REFERENCE_PATH = path.join(process.cwd(), 'does-not-exist.json');
    vi.resetModules();

    const { searchWorkbookSchema: isolatedSearch } = await import('./searchLibrary.js');
    expect(isolatedSearch({ enumType: 'PrimitiveType-ST' }).source).toBe('twb_2026.2.0.xsd');
  });

  it('bounds override read errors without exposing an untrusted path', async () => {
    process.env.WORKBOOK_XSD_PATH = `PRIVATE_MARKER_${'x'.repeat(70 * 1024)}`;
    delete process.env.SCHEMA_REFERENCE_PATH;
    vi.resetModules();

    const { searchWorkbookSchema: isolatedSearch } = await import('./searchLibrary.js');
    let message = '';
    try {
      isolatedSearch({ elementType: 'anything' });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(Buffer.byteLength(message)).toBeLessThan(1024);
    expect(message).toContain('Workbook XSD not available');
    expect(message).toMatch(/override path \(\d+ bytes, sha256:[a-f0-9]{12}\)/);
    expect(message).toMatch(/read failure \(\d+ bytes, sha256:[a-f0-9]{12}\)/);
    expect(message).not.toContain('PRIVATE_MARKER');
  });

  it('fails clearly when the deprecated schema path points to flattened JSON', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tmcp-schema-'));
    const flattenedPath = path.join(tempDir, 'workbook-schema-reference.json');
    fs.writeFileSync(flattenedPath, '{"version":"old-flattened-schema"}');
    delete process.env.WORKBOOK_XSD_PATH;
    process.env.SCHEMA_REFERENCE_PATH = flattenedPath;
    vi.resetModules();

    try {
      const { searchWorkbookSchema: isolatedSearch } = await import('./searchLibrary.js');
      expect(() => isolatedSearch({ enumType: 'PrimitiveType-ST' })).toThrow(
        /SCHEMA_REFERENCE_PATH.*raw XSD.*flattened JSON/,
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects malformed override XSD instead of caching warning-only parser recovery', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tmcp-xsd-'));
    const malformedPath = path.join(tempDir, 'malformed.xsd');
    fs.writeFileSync(
      malformedPath,
      '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name=broken/></xs:schema>',
    );
    process.env.WORKBOOK_XSD_PATH = malformedPath;
    delete process.env.SCHEMA_REFERENCE_PATH;
    vi.resetModules();

    try {
      const { searchWorkbookSchema: isolatedSearch } = await import('./searchLibrary.js');
      expect(() => isolatedSearch({ elementType: 'broken' })).toThrow(
        /Workbook XSD is not valid XML/,
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('bounds parser callback diagnostics without exposing malformed override XML', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tmcp-xsd-callback-'));
    const malformedPath = path.join(tempDir, 'callback-diagnostic.xsd');
    const privateContent = `PRIVATE_MARKER_${'x'.repeat(70 * 1024)}`;
    fs.writeFileSync(
      malformedPath,
      `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name=${privateContent}/></xs:schema>`,
    );
    process.env.WORKBOOK_XSD_PATH = malformedPath;
    delete process.env.SCHEMA_REFERENCE_PATH;
    vi.resetModules();

    try {
      const { searchWorkbookSchema: isolatedSearch } = await import('./searchLibrary.js');
      let message = '';
      try {
        isolatedSearch({ elementType: 'anything' });
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(Buffer.byteLength(message)).toBeLessThan(1024);
      expect(message).toContain('Workbook XSD is not valid XML');
      expect(message).toContain('callback-diagnostic.xsd');
      expect(message).toMatch(/parser diagnostic \(\d+ bytes, sha256:[a-f0-9]{12}\)/);
      expect(message).not.toContain('PRIVATE_MARKER');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('bounds thrown parser errors without exposing malformed override XML', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tmcp-xsd-thrown-'));
    const malformedPath = path.join(tempDir, 'thrown-parser-error.xsd');
    const privateContent = `PRIVATE_MARKER_${'x'.repeat(70 * 1024)}`;
    fs.writeFileSync(
      malformedPath,
      `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><${privateContent}></xs:schema>`,
    );
    process.env.WORKBOOK_XSD_PATH = malformedPath;
    delete process.env.SCHEMA_REFERENCE_PATH;
    vi.resetModules();

    try {
      const { searchWorkbookSchema: isolatedSearch } = await import('./searchLibrary.js');
      let message = '';
      try {
        isolatedSearch({ elementType: 'anything' });
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(Buffer.byteLength(message)).toBeLessThan(1024);
      expect(message).toContain('Workbook XSD is not valid XML');
      expect(message).toContain('thrown-parser-error.xsd');
      expect(message).toMatch(/parser diagnostic \(\d+ bytes, sha256:[a-f0-9]{12}\)/);
      expect(message).not.toContain('PRIVATE_MARKER');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects a well-formed override that is not an XSD schema', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tmcp-not-xsd-'));
    const nonSchemaPath = path.join(tempDir, 'PRIVATE_MARKER non-schema.xsd');
    fs.writeFileSync(nonSchemaPath, '<not-schema/>');
    process.env.WORKBOOK_XSD_PATH = nonSchemaPath;
    delete process.env.SCHEMA_REFERENCE_PATH;
    vi.resetModules();

    try {
      const { searchWorkbookSchema: isolatedSearch } = await import('./searchLibrary.js');
      let message = '';
      try {
        isolatedSearch({ elementType: 'anything' });
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(Buffer.byteLength(message)).toBeLessThan(1024);
      expect(message).toContain('Workbook XSD root must be xs:schema');
      expect(message).toMatch(/override path \(\d+ bytes, sha256:[a-f0-9]{12}\)/);
      expect(message).not.toContain('PRIVATE_MARKER');
      expect(message).not.toContain(tempDir);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects an XSD override with no indexed declarations', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tmcp-empty-xsd-'));
    const emptySchemaPath = path.join(tempDir, 'PRIVATE_MARKER empty.xsd');
    fs.writeFileSync(emptySchemaPath, '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"/>');
    process.env.WORKBOOK_XSD_PATH = emptySchemaPath;
    delete process.env.SCHEMA_REFERENCE_PATH;
    vi.resetModules();

    try {
      const { searchWorkbookSchema: isolatedSearch } = await import('./searchLibrary.js');
      let message = '';
      try {
        isolatedSearch({ elementType: 'anything' });
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(Buffer.byteLength(message)).toBeLessThan(1024);
      expect(message).toContain('Workbook XSD contains no named declarations');
      expect(message).toMatch(/override path \(\d+ bytes, sha256:[a-f0-9]{12}\)/);
      expect(message).not.toContain('PRIVATE_MARKER');
      expect(message).not.toContain(tempDir);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects a raw declaration too large to return without leaking its content', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tmcp-large-xsd-'));
    const oversizedPath = path.join(tempDir, 'oversized.xsd');
    const privateContent = `PRIVATE_MARKER_${'x'.repeat(70 * 1024)}`;
    fs.writeFileSync(
      oversizedPath,
      `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:simpleType name="Oversized-ST"><xs:annotation><xs:documentation>${privateContent}</xs:documentation></xs:annotation><xs:restriction base="xs:string"/></xs:simpleType></xs:schema>`,
    );
    process.env.WORKBOOK_XSD_PATH = oversizedPath;
    delete process.env.SCHEMA_REFERENCE_PATH;
    vi.resetModules();

    try {
      const { searchWorkbookSchema: isolatedSearch } = await import('./searchLibrary.js');
      let message = '';
      try {
        isolatedSearch({ enumType: 'Oversized-ST' });
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).toMatch(/Oversized-ST.*exceeds the 64 KiB response ceiling/);
      expect(message).not.toContain('PRIVATE_MARKER');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('bounds oversized declaration errors without exposing an untrusted long name', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tmcp-long-name-xsd-'));
    const oversizedPath = path.join(tempDir, 'long-name.xsd');
    const privateName = `PRIVATE_MARKER_${'x'.repeat(70 * 1024)}`;
    fs.writeFileSync(
      oversizedPath,
      `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:simpleType name="${privateName}"><xs:restriction base="xs:string"/></xs:simpleType></xs:schema>`,
    );
    process.env.WORKBOOK_XSD_PATH = oversizedPath;
    delete process.env.SCHEMA_REFERENCE_PATH;
    vi.resetModules();

    try {
      const { searchWorkbookSchema: isolatedSearch } = await import('./searchLibrary.js');
      let message = '';
      try {
        isolatedSearch({ enumType: privateName });
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(Buffer.byteLength(message)).toBeLessThan(1024);
      expect(message).toMatch(/name \(\d+ bytes, sha256:[a-f0-9]{12}\)/);
      expect(message).not.toContain('PRIVATE_MARKER');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects an exact result made oversized by parent paths without leaking content', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tmcp-parent-paths-xsd-'));
    const oversizedPath = path.join(tempDir, 'parent-paths.xsd');
    const references = Array.from(
      { length: 3000 },
      (_, index) =>
        `<xs:element name="Reference-Parent-Number-${index}-For-Target" type="Target-ST"/>`,
    ).join('');
    fs.writeFileSync(
      oversizedPath,
      `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:simpleType name="Target-ST"><xs:annotation><xs:documentation>PRIVATE_PARENT_MARKER</xs:documentation></xs:annotation><xs:restriction base="xs:string"/></xs:simpleType>${references}</xs:schema>`,
    );
    process.env.WORKBOOK_XSD_PATH = oversizedPath;
    delete process.env.SCHEMA_REFERENCE_PATH;
    vi.resetModules();

    try {
      const { searchWorkbookSchema: isolatedSearch } = await import('./searchLibrary.js');
      let message = '';
      try {
        isolatedSearch({ enumType: 'Target-ST', expandRefs: true });
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).toMatch(/Target-ST.*exceeds the 64 KiB response ceiling.*query.*separately/i);
      expect(message).not.toContain('PRIVATE_PARENT_MARKER');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects two required declarations that cannot fit together', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tmcp-required-xsd-'));
    const oversizedPath = path.join(tempDir, 'required.xsd');
    const privateContent = `PRIVATE_REQUIRED_MARKER_${'x'.repeat(35 * 1024)}`;
    fs.writeFileSync(
      oversizedPath,
      `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:simpleType name="First-ST"><xs:annotation><xs:documentation>${privateContent}</xs:documentation></xs:annotation><xs:restriction base="xs:string"/></xs:simpleType><xs:complexType name="Second-CT"><xs:annotation><xs:documentation>${privateContent}</xs:documentation></xs:annotation><xs:sequence/></xs:complexType></xs:schema>`,
    );
    process.env.WORKBOOK_XSD_PATH = oversizedPath;
    delete process.env.SCHEMA_REFERENCE_PATH;
    vi.resetModules();

    try {
      const { searchWorkbookSchema: isolatedSearch } = await import('./searchLibrary.js');
      let message = '';
      try {
        isolatedSearch({ enumType: 'First-ST', elementType: 'Second-CT' });
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).toMatch(
        /First-ST.*Second-CT.*exceeds the 64 KiB response ceiling.*query.*separately/i,
      );
      expect(message).not.toContain('PRIVATE_REQUIRED_MARKER');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('keeps every expanded exact declaration lookup below the conservative response ceiling', () => {
    const raw = readDataAsset('twb_2026.2.0.xsd');
    expect(raw).not.toBeNull();
    const doc = new DOMParser().parseFromString(raw!, 'application/xml');
    const root = doc.documentElement;
    expect(root).not.toBeNull();

    for (let node = root!.firstChild; node; node = node.nextSibling) {
      if (node.nodeType !== 1) continue;
      const name = (node as XmlElement).getAttribute('name');
      if (!name) continue;
      const args =
        node.localName === 'simpleType'
          ? { enumType: name, expandRefs: true }
          : { elementType: name, expandRefs: true };
      const result = searchWorkbookSchema(args);
      expect(Buffer.byteLength(JSON.stringify(result, null, 2)), name).toBeLessThan(64 * 1024);
    }
  });
});
