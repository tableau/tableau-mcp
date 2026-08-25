import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { DOMParser } from '@xmldom/xmldom';

import { bindTemplate } from '../desktop/binder/binder.js';
import { loadRuntimeTemplateDescriptors } from '../desktop/templates/runtimeTemplateCatalog.js';
import { listTemplateNames, readTemplate } from '../desktop/templates/templatePath.js';
import {
  buildTemplateContentPack,
  resolveTemplateContentPackVersion,
  validateTemplateNames,
} from './buildTemplateContentPack.js';

type ZipEntry = {
  name: string;
  bytes: Buffer;
  modifiedTime: number;
  modifiedDate: number;
};

function readStoredZip(archive: Buffer): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let offset = 0;

  while (archive.readUInt32LE(offset) === 0x04034b50) {
    const method = archive.readUInt16LE(offset + 8);
    const modifiedTime = archive.readUInt16LE(offset + 10);
    const modifiedDate = archive.readUInt16LE(offset + 12);
    const size = archive.readUInt32LE(offset + 18);
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;

    expect(method).toBe(0);
    entries.push({
      name: archive.subarray(nameStart, dataStart - extraLength).toString('utf8'),
      bytes: archive.subarray(dataStart, dataStart + size),
      modifiedTime,
      modifiedDate,
    });
    offset = dataStart + size;
  }

  expect(archive.readUInt32LE(offset)).toBe(0x02014b50);
  return entries;
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function fixture(): Promise<{ inputDir: string; outputDir: string }> {
  const root = await mkdtemp(join(tmpdir(), 'template-content-pack-'));
  const inputDir = join(root, 'templates');
  const outputDir = join(root, 'output');
  await mkdir(inputDir);
  return { inputDir, outputDir };
}

describe('buildTemplateContentPack', () => {
  it('writes a byte-deterministic versioned ZIP with sorted TBMs and a minimal integrity inventory', async () => {
    const { inputDir, outputDir } = await fixture();
    const alpha = Buffer.from("<?xml version='1.0'?><bookmark name='alpha'/>");
    const zulu = Buffer.from("<?xml version='1.0'?><bookmark name='zulu'/>");
    await writeFile(join(inputDir, 'zulu.tbm'), zulu);
    await writeFile(join(inputDir, 'alpha.tbm'), alpha);
    await writeFile(join(inputDir, 'ignored.xml'), '<bookmark/>');
    await utimes(join(inputDir, 'alpha.tbm'), new Date(1_000), new Date(2_000));
    await utimes(join(inputDir, 'zulu.tbm'), new Date(3_000), new Date(4_000));

    const firstPath = await buildTemplateContentPack({ inputDir, outputDir, version: '1.2.3' });
    const first = await readFile(firstPath);
    await utimes(join(inputDir, 'alpha.tbm'), new Date(), new Date());
    const secondPath = await buildTemplateContentPack({
      inputDir,
      outputDir: join(outputDir, 'again'),
      version: '1.2.3',
    });
    const second = await readFile(secondPath);

    expect(basename(firstPath)).toBe('tableau-template-content-pack-1.2.3.zip');
    expect(second).toEqual(first);

    const entries = readStoredZip(first);
    expect(entries.map(({ name }) => name)).toEqual(['alpha.tbm', 'zulu.tbm', 'integrity.json']);
    expect(entries.map(({ modifiedTime, modifiedDate }) => [modifiedTime, modifiedDate])).toEqual([
      [0, 33],
      [0, 33],
      [0, 33],
    ]);
    expect(entries[0]?.bytes).toEqual(alpha);
    expect(entries[1]?.bytes).toEqual(zulu);
    expect(JSON.parse(entries[2]?.bytes.toString('utf8') ?? '')).toEqual({
      version: 1,
      files: [
        { name: 'alpha.tbm', sha256: sha256(alpha) },
        { name: 'zulu.tbm', sha256: sha256(zulu) },
      ],
    });
  });

  it('rejects an input directory without TBM files', async () => {
    const { inputDir, outputDir } = await fixture();
    await writeFile(join(inputDir, 'not-a-template.xml'), '<bookmark/>');

    await expect(
      buildTemplateContentPack({ inputDir, outputDir, version: '1.0.0' }),
    ).rejects.toThrow('contains no .tbm files');
  });

  it.each(['<bookmark>', '<bookmark/>junk', '<a/><b/>'])(
    'rejects malformed TBM XML: %s',
    async (xml) => {
      const { inputDir, outputDir } = await fixture();
      await writeFile(join(inputDir, 'broken.tbm'), xml);

      await expect(
        buildTemplateContentPack({ inputDir, outputDir, version: '1.0.0' }),
      ).rejects.toThrow('broken.tbm is not a well-formed Tableau bookmark');
    },
  );

  it('rejects well-formed XML whose root is not bookmark', async () => {
    const { inputDir, outputDir } = await fixture();
    await writeFile(join(inputDir, 'not-a-bookmark.tbm'), '<workbook/>');

    await expect(
      buildTemplateContentPack({ inputDir, outputDir, version: '1.0.0' }),
    ).rejects.toThrow('not-a-bookmark.tbm is not a well-formed Tableau bookmark');
  });

  it('rejects empty TBM bytes', async () => {
    const { inputDir, outputDir } = await fixture();
    await writeFile(join(inputDir, 'broken.tbm'), '');

    await expect(
      buildTemplateContentPack({ inputDir, outputDir, version: '1.0.0' }),
    ).rejects.toThrow('broken.tbm is not a well-formed Tableau bookmark');
  });

  it.each([
    ['api-key', 'not-a-real-api-key'],
    ['apiKey', 'not-a-real-api-key'],
    ['password', 'not-a-real-password'],
    ['access-token', 'not-a-real-access-token'],
    ['accessToken', 'not-a-real-access-token'],
    ['clientSecret', 'not-a-real-client-secret'],
    ['privateKey', 'not-a-real-private-key'],
    ['x:apiKey', 'not-a-real-api-key'],
    ['connection-api-key', 'not-a-real-api-key'],
    ['oauth-client-secret', 'not-a-real-client-secret'],
    ['myPassword', 'not-a-real-password'],
  ])(
    'rejects a non-empty credential-like %s attribute without echoing its value',
    async (name, value) => {
      const { inputDir, outputDir } = await fixture();
      await writeFile(
        join(inputDir, 'unsafe.tbm'),
        `<bookmark${name.includes(':') ? " xmlns:x='urn:test'" : ''}><connection ${name}='${value}'/></bookmark>`,
      );

      let message = '';
      try {
        await buildTemplateContentPack({ inputDir, outputDir, version: '1.0.0' });
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }

      expect(message).toBe(`unsafe.tbm contains a non-empty credential-like attribute: ${name}`);
      expect(message).not.toContain(value);
    },
  );

  it('allows empty credential-like attributes', async () => {
    const { inputDir, outputDir } = await fixture();
    await writeFile(
      join(inputDir, 'safe.tbm'),
      "<bookmark><connection api-key='' password=''/></bookmark>",
    );

    await expect(
      buildTemplateContentPack({ inputDir, outputDir, version: '1.0.0' }),
    ).resolves.toContain('tableau-template-content-pack-1.0.0.zip');
  });

  it('allows bare generic key names in attributes and query parameters', async () => {
    const { inputDir, outputDir } = await fixture();
    await writeFile(
      join(inputDir, 'safe.tbm'),
      "<bookmark><connection key='dimension-key' url-format='/styles/example?key=map-style'/></bookmark>",
    );

    await expect(
      buildTemplateContentPack({ inputDir, outputDir, version: '1.0.0' }),
    ).resolves.toContain('tableau-template-content-pack-1.0.0.zip');
  });

  it('rejects a compact credential-like attribute on the bookmark root without echoing it', async () => {
    const { inputDir, outputDir } = await fixture();
    const value = 'not-a-real-api-key';
    await writeFile(join(inputDir, 'unsafe.tbm'), `<bookmark apiKey='${value}'/>`);

    let message = '';
    try {
      await buildTemplateContentPack({ inputDir, outputDir, version: '1.0.0' });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toBe('unsafe.tbm contains a non-empty credential-like attribute: apiKey');
    expect(message).not.toContain(value);
  });

  it.each([
    ['dbname', '/Users/example/private/data.hyper'],
    ['directory', '/var/folders/example'],
    ['ogr-grid-shift-folder', '/Applications/Tableau.app/Contents'],
    ['filename', '/Volumes/shared/data.hyper'],
    ['filepath', 'G:/My Drive/data.hyper'],
    ['folder', '\\\\server\\share\\data.hyper'],
    ['path', 'file:///var/data/data.hyper'],
    ['dbname', 'C:\\Users\\example\\private\\data.hyper'],
    ['dbname', 'C:/Users/example/private/data.hyper'],
    ['dbname', 'C:&#92;Users&#92;example&#92;private&#92;data.hyper'],
    ['directory', '&#47;var&#47;folders&#47;example'],
  ])('rejects an absolute local path in %s without echoing it', async (attribute, path) => {
    const { inputDir, outputDir } = await fixture();
    await writeFile(
      join(inputDir, 'unsafe.tbm'),
      `<bookmark><connection ${attribute}='${path}'/></bookmark>`,
    );

    let message = '';
    try {
      await buildTemplateContentPack({ inputDir, outputDir, version: '1.0.0' });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toBe('unsafe.tbm contains an absolute local path');
    expect(message).not.toContain(path);
  });

  it('allows root-relative Tableau URL formats', async () => {
    const { inputDir, outputDir } = await fixture();
    await writeFile(
      join(inputDir, 'safe.tbm'),
      "<bookmark><connection url-format='/styles/{z}/{x}/{y}.png'/></bookmark>",
    );

    await expect(
      buildTemplateContentPack({ inputDir, outputDir, version: '1.0.0' }),
    ).resolves.toContain('tableau-template-content-pack-1.0.0.zip');
  });

  it.each([
    ['access_token', 'pk.not-a-real-token'],
    ['access%5Ftoken', 'pk.not-a-real-token'],
    ['apiKey', 'not-a-real-api-key'],
    ['client_secret', 'not-a-real-client-secret'],
    ['oauth_client_secret', 'not-a-real-client-secret'],
  ])('rejects a non-empty credential query value for %s without echoing it', async (key, value) => {
    const { inputDir, outputDir } = await fixture();
    await writeFile(
      join(inputDir, 'unsafe.tbm'),
      `<bookmark><connection url-format='/styles/example?${key}=${value}'/></bookmark>`,
    );

    let message = '';
    try {
      await buildTemplateContentPack({ inputDir, outputDir, version: '1.0.0' });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toBe(
      'unsafe.tbm contains a non-empty credential query value in attribute: url-format',
    );
    expect(message).not.toContain(value);
  });

  it('allows an empty credential query value', async () => {
    const { inputDir, outputDir } = await fixture();
    await writeFile(
      join(inputDir, 'safe.tbm'),
      "<bookmark><connection url-format='/styles/example?access_token='/></bookmark>",
    );

    await expect(
      buildTemplateContentPack({ inputDir, outputDir, version: '1.0.0' }),
    ).resolves.toContain('tableau-template-content-pack-1.0.0.zip');
  });

  it(
    'packages the source corpus without credential values or local user paths',
    { timeout: 30_000 },
    async () => {
      const { outputDir } = await fixture();
      const archivePath = await buildTemplateContentPack({
        inputDir: join(process.cwd(), 'src', 'desktop', 'data', 'templates'),
        outputDir,
        version: '1.0.0',
      });
      const entries = readStoredZip(await readFile(archivePath));
      const templates = entries.filter(({ name }) => name.endsWith('.tbm'));
      const corpus = Buffer.concat(templates.map(({ bytes }) => bytes)).toString('utf8');
      let absolutePathAttributes = 0;
      let credentialAttributes = 0;
      let credentialQueryValues = 0;
      for (const template of templates) {
        const document = new DOMParser().parseFromString(
          template.bytes.toString('utf8'),
          'text/xml',
        );
        const elements = document.getElementsByTagName('*');
        for (let elementIndex = 0; elementIndex < elements.length; elementIndex += 1) {
          const attributes = elements.item(elementIndex)?.attributes;
          if (attributes === undefined) continue;
          for (let attributeIndex = 0; attributeIndex < attributes.length; attributeIndex += 1) {
            const attribute = attributes.item(attributeIndex);
            if (
              attribute !== null &&
              /(?:dbname|directory|filename|path|folder)/i.test(attribute.name) &&
              /^(?:\/(?!\/)|\/\/[^/\\]|[A-Za-z]:[\\/]|\\\\[^\\/]|file:[\\/]{1,3})/i.test(
                attribute.value.trim(),
              )
            ) {
              absolutePathAttributes += 1;
            }
            if (attribute !== null) {
              const normalizedAttributeName = attribute.name
                .replace(/[^A-Za-z0-9]/g, '')
                .toLowerCase();
              if (
                /(?:accesstoken|apikey|authtoken|bearertoken|clientsecret|credential|idtoken|oauthaccesstoken|passphrase|passwd|password|privatekey|refreshtoken|secret|secretaccesskey|secretkey|secrettoken|token)$/.test(
                  normalizedAttributeName,
                ) &&
                attribute.value.trim() !== ''
              ) {
                credentialAttributes += 1;
              }
              for (const match of attribute.value.matchAll(
                /(?:^|[?&;])([^?=&#;\s]+)=([^&#;\s]*)/g,
              )) {
                const normalizedKey = match[1]?.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
                if (
                  normalizedKey !== undefined &&
                  /(?:accesstoken|apikey|authtoken|bearertoken|clientsecret|credential|idtoken|oauthaccesstoken|passphrase|passwd|password|privatekey|refreshtoken|secret|secretaccesskey|secretkey|secrettoken|token)$/.test(
                    normalizedKey,
                  ) &&
                  (match[2] ?? '').trim() !== ''
                ) {
                  credentialQueryValues += 1;
                }
              }
            }
          }
        }
      }

      // 134 base + the 2 insight templates (insights_bar_chart, insights_line_chart).
      expect(templates).toHaveLength(136);
      expect(/\bapi-key\s*=\s*(['"])[^'"]+\1/i.test(corpus)).toBe(false);
      expect(absolutePathAttributes).toBe(0);
      expect(credentialAttributes).toBe(0);
      expect(credentialQueryValues).toBe(0);
    },
  );

  it('rejects a TBM larger than 512 KiB', async () => {
    const { inputDir, outputDir } = await fixture();
    await writeFile(join(inputDir, 'large.tbm'), `<bookmark>${'x'.repeat(512 * 1024)}</bookmark>`);

    await expect(
      buildTemplateContentPack({ inputDir, outputDir, version: '1.0.0' }),
    ).rejects.toThrow('large.tbm exceeds 524288 bytes');
  });

  it('rejects case-insensitive duplicate relative names', () => {
    expect(() => validateTemplateNames(['sales.tbm', 'sales.tbm'])).toThrow(
      'Duplicate template name: sales.tbm',
    );
  });

  it('rejects names that are not safe flat relative paths', () => {
    expect(() => validateTemplateNames(['../escape.tbm'])).toThrow(
      'Unsafe template name: ../escape.tbm',
    );
    expect(() => validateTemplateNames(['nested\\escape.tbm'])).toThrow(
      'Unsafe template name: nested\\escape.tbm',
    );
    expect(() => validateTemplateNames(['CON.tbm'])).toThrow('Unsafe template name: CON.tbm');
    expect(() => validateTemplateNames(['name:stream.tbm'])).toThrow(
      'Unsafe template name: name:stream.tbm',
    );
    for (const name of ['Upper.tbm', 'café.tbm', 'emoji😀.tbm', 'con.tbm', 'name .tbm']) {
      expect(() => validateTemplateNames([name])).toThrow(`Unsafe template name: ${name}`);
    }
    expect(() => validateTemplateNames([`${'a'.repeat(65_532)}.tbm`])).toThrow(
      'Template name exceeds the ZIP32 limit',
    );
  });

  it('rejects non-regular TBM inputs', async () => {
    const { inputDir, outputDir } = await fixture();
    await mkdir(join(inputDir, 'directory.tbm'));

    await expect(
      buildTemplateContentPack({ inputDir, outputDir, version: '1.0.0' }),
    ).rejects.toThrow('directory.tbm must be a regular file');
  });

  it('replaces an output symlink without writing through it when symlinks are supported', async () => {
    const { inputDir, outputDir } = await fixture();
    await mkdir(outputDir);
    await writeFile(join(inputDir, 'safe.tbm'), '<bookmark/>');
    const target = join(outputDir, 'target.txt');
    const output = join(outputDir, 'tableau-template-content-pack-1.0.0.zip');
    await writeFile(target, 'do not replace');
    try {
      await symlink(target, output);
    } catch {
      return;
    }

    await buildTemplateContentPack({ inputDir, outputDir, version: '1.0.0' });

    expect(await readFile(target, 'utf8')).toBe('do not replace');
    expect((await lstat(output)).isSymbolicLink()).toBe(false);
  });

  it('rejects more than 512 templates', () => {
    expect(() => validateTemplateNames(new Array(513).fill('safe.tbm'))).toThrow(
      'Template count exceeds 512: 513',
    );
  });

  it('rejects an unsafe content pack version before constructing the output path', async () => {
    const { inputDir, outputDir } = await fixture();
    await writeFile(join(inputDir, 'safe.tbm'), '<bookmark/>');

    await expect(
      buildTemplateContentPack({ inputDir, outputDir, version: '../escape' }),
    ).rejects.toThrow('Template content pack version must be SemVer without build metadata');
  });
});

describe('resolveTemplateContentPackVersion', () => {
  it('uses an explicit CLI version ahead of environment and package fallbacks', () => {
    expect(
      resolveTemplateContentPackVersion({
        args: ['--version', '1.2.3-rc.1'],
        environmentVersion: '4.5.6',
        packageVersion: '2.60.4',
      }),
    ).toEqual({ version: '1.2.3-rc.1', source: '--version' });
  });

  it('uses TEMPLATE_CONTENT_PACK_VERSION when no CLI version is present', () => {
    expect(
      resolveTemplateContentPackVersion({
        args: [],
        environmentVersion: '3.4.5-beta.7',
        packageVersion: '2.60.4',
      }),
    ).toEqual({ version: '3.4.5-beta.7', source: 'TEMPLATE_CONTENT_PACK_VERSION' });
  });

  it('uses package.json only as the local fallback', () => {
    expect(resolveTemplateContentPackVersion({ args: [], packageVersion: '2.60.4' })).toEqual({
      version: '2.60.4',
      source: 'package.json',
    });
  });

  it.each([
    { args: ['--version'], message: '--version requires a value' },
    {
      args: ['--version', 'one', '--version=two'],
      message: '--version may be provided only once',
    },
    { args: ['--other', 'value'], message: 'Unknown argument: --other' },
    {
      args: ['--version', '../escape'],
      message: 'Template content pack version must be SemVer without build metadata: ../escape',
    },
    {
      args: ['--version', 'templates-7'],
      message: 'Template content pack version must be SemVer without build metadata: templates-7',
    },
    {
      args: ['--version', 'release-2026.08'],
      message:
        'Template content pack version must be SemVer without build metadata: release-2026.08',
    },
    {
      args: ['--version', '1.2.3+build'],
      message: 'Template content pack version must be SemVer without build metadata: 1.2.3+build',
    },
  ])('rejects ambiguous or invalid CLI input: $args', ({ args, message }) => {
    expect(() => resolveTemplateContentPackVersion({ args, packageVersion: '2.60.4' })).toThrow(
      message,
    );
  });
});

describe('two-artifact packaging boundary', () => {
  it('temporarily stages only the TBM corpus in the MCP desktop-data allowlist', async () => {
    const buildScript = await readFile(join(process.cwd(), 'src', 'scripts', 'build.ts'), 'utf8');
    const allowlist = buildScript.match(/const stagedDesktopData = \[([\s\S]*?)\];/)?.[1];

    expect(allowlist).toBeDefined();
    expect(allowlist).toMatch(/['"]templates['"]/);
    expect(allowlist).not.toMatch(/['"]template-manifests['"]/);
    expect(allowlist).not.toMatch(/['"]content-manifest\.json['"]/);
    expect(allowlist).not.toMatch(/['"]data-visualization-templates-xml['"]/);
  });

  it('stages the raw 2026.2 workbook XSD instead of the flattened schema snapshot', async () => {
    const buildScript = await readFile(join(process.cwd(), 'src', 'scripts', 'build.ts'), 'utf8');
    const allowlist = buildScript.match(/const stagedDesktopData = \[([\s\S]*?)\];/)?.[1];

    expect(allowlist).toBeDefined();
    expect(allowlist).toMatch(/['"]twb_2026\.2\.0\.xsd['"]/);
    expect(allowlist).not.toMatch(/['"]workbook-schema-reference\.json['"]/);
  });

  it('lists, reads, and binds an extracted generated pack mounted through TEMPLATES_DIR', async () => {
    const { inputDir, outputDir } = await fixture();
    const mountedDir = join(outputDir, 'mounted');
    const bookmark =
      "<?xml version='1.0'?><bookmark version='10.1'>" +
      '<datasources>' +
      "<datasource name='federated.donor'>" +
      "<column name='[Value]' datatype='real' role='measure' type='quantitative'/>" +
      "<column name='[Member]' datatype='string' role='dimension' type='nominal'/>" +
      '</datasource>' +
      '</datasources>' +
      '<table><rows>[federated.donor].[none:Member:nk]</rows>' +
      '<cols>[federated.donor].[sum:Value:qk]</cols></table>' +
      '</bookmark>';
    await writeFile(join(inputDir, 'ranking-ordered-bar.tbm'), bookmark);
    const archivePath = await buildTemplateContentPack({
      inputDir,
      outputDir,
      version: '1.2.3',
    });
    const entries = readStoredZip(await readFile(archivePath));
    await mkdir(mountedDir);
    for (const entry of entries.filter(({ name }) => name.endsWith('.tbm'))) {
      await writeFile(join(mountedDir, entry.name), entry.bytes);
    }

    const previousTemplatesDir = process.env['TEMPLATES_DIR'];
    try {
      process.env['TEMPLATES_DIR'] = mountedDir;
      expect(listTemplateNames()).toEqual(['ranking-ordered-bar']);
      expect(readTemplate('ranking-ordered-bar')).toContain('<worksheet');

      const manifests = loadRuntimeTemplateDescriptors();
      const descriptor = manifests.get('ranking-ordered-bar');
      expect(descriptor).toBeDefined();
      const bindings = descriptor!.slots
        .filter(({ required, bindable }) => required && bindable)
        .map(({ slot_id: slotId, kind }) => ({
          slot_id: slotId,
          field: kind === 'quantitative' ? 'Value' : 'Member',
        }));
      const result = await bindTemplate({
        ask: 'bar chart of Value by Member',
        workbookXml:
          "<workbook><datasources><datasource name='Live'>" +
          "<column name='[Value]' datatype='real' role='measure' type='quantitative'/>" +
          "<column name='[Member]' datatype='string' role='dimension' type='nominal'/>" +
          '</datasource></datasources></workbook>',
        manifests,
        proposal: {
          template: 'ranking-ordered-bar',
          title: 'Value by Member',
          bindings,
        },
      });
      expect(result.status).toBe('bound');
      if (result.status === 'bound') {
        expect(result.args.template_name).toBe('ranking-ordered-bar');
      }
    } finally {
      if (previousTemplatesDir === undefined) delete process.env['TEMPLATES_DIR'];
      else process.env['TEMPLATES_DIR'] = previousTemplatesDir;
      await rm(mountedDir, { recursive: true, force: true });
    }
  });
});
