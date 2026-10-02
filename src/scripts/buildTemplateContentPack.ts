import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

import { DOMParser } from '@xmldom/xmldom';

const ARCHIVE_PREFIX = 'tableau-template-content-pack';
const INTEGRITY_NAME = 'integrity.json';
const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP_UTF8_FLAG = 0x0800;
const ZIP_DOS_EPOCH_DATE = 33;
const PUBLISHED_TEMPLATE_NAME = /^[a-z0-9][a-z0-9._-]*\.tbm$/;
const MAX_TEMPLATE_COUNT = 512;
const MAX_TEMPLATE_BYTES = 512 * 1024;
const MAX_INTEGRITY_BYTES = 512 * 1024;
const MAX_CONTENT_BYTES = MAX_TEMPLATE_COUNT * MAX_TEMPLATE_BYTES + MAX_INTEGRITY_BYTES;
const CREDENTIAL_ATTRIBUTE_NAMES = new Set([
  'accesstoken',
  'apikey',
  'authtoken',
  'bearertoken',
  'clientsecret',
  'credential',
  'idtoken',
  'oauthaccesstoken',
  'passphrase',
  'passwd',
  'password',
  'privatekey',
  'refreshtoken',
  'secret',
  'secretaccesskey',
  'secretkey',
  'secrettoken',
  'token',
]);
const CREDENTIAL_NAME_SUFFIXES = [
  'accesstoken',
  'apikey',
  'authtoken',
  'bearertoken',
  'clientsecret',
  'credential',
  'idtoken',
  'oauthaccesstoken',
  'passphrase',
  'passwd',
  'password',
  'privatekey',
  'refreshtoken',
  'secret',
  'secretaccesskey',
  'secretkey',
  'secrettoken',
  'token',
];
const PATH_BEARING_ATTRIBUTE = /(?:dbname|directory|filename|path|folder)/i;
const ABSOLUTE_FILESYSTEM_PATH =
  /^(?:\/(?!\/)|\/\/[^/\\]|[A-Za-z]:[\\/]|\\\\[^\\/]|file:[\\/]{1,3})/i;
const ATTRIBUTE_PARAMETER = /(?:^|[?&;])([^?=&#;\s]+)=([^&#;\s]*)/g;
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?$/;

export type BuildTemplateContentPackOptions = {
  inputDir: string;
  outputDir: string;
  version: string;
};

export type ResolveTemplateContentPackVersionOptions = {
  args: string[];
  environmentVersion?: string;
  packageVersion: string;
};

export type ResolvedTemplateContentPackVersion = {
  version: string;
  source: '--version' | 'TEMPLATE_CONTENT_PACK_VERSION' | 'package.json';
};

type PackFile = {
  name: string;
  bytes: Buffer;
};

type ZipRecord = {
  centralDirectory: Buffer;
  localFile: Buffer;
};

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ (crcTable[(crc ^ byte) & 0xff] ?? 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function validateVersion(version: string): void {
  if (!SEMVER.test(version)) {
    throw new Error(
      `Template content pack version must be SemVer without build metadata: ${version}`,
    );
  }
}

export function resolveTemplateContentPackVersion(
  options: ResolveTemplateContentPackVersionOptions,
): ResolvedTemplateContentPackVersion {
  const cliVersions: string[] = [];
  for (let index = 0; index < options.args.length; index += 1) {
    const argument = options.args[index];
    if (argument === '--version') {
      const value = options.args[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error('--version requires a value');
      }
      cliVersions.push(value);
      index += 1;
    } else if (argument?.startsWith('--version=')) {
      cliVersions.push(argument.slice('--version='.length));
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (cliVersions.length > 1) {
    throw new Error('--version may be provided only once');
  }

  const resolved =
    cliVersions[0] !== undefined
      ? { version: cliVersions[0], source: '--version' as const }
      : options.environmentVersion !== undefined
        ? {
            version: options.environmentVersion,
            source: 'TEMPLATE_CONTENT_PACK_VERSION' as const,
          }
        : { version: options.packageVersion, source: 'package.json' as const };
  validateVersion(resolved.version);
  return resolved;
}

function validateTemplateName(name: string): void {
  const windowsDeviceName = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
  if (
    !PUBLISHED_TEMPLATE_NAME.test(name) ||
    basename(name) !== name ||
    windowsDeviceName.test(name)
  ) {
    throw new Error(`Unsafe template name: ${name}`);
  }
  if (Buffer.byteLength(name, 'utf8') > 0xffff) {
    throw new Error(`Template name exceeds the ZIP32 limit: ${name}`);
  }
}

export function validateTemplateNames(names: string[]): void {
  if (names.length > MAX_TEMPLATE_COUNT) {
    throw new Error(`Template count exceeds ${MAX_TEMPLATE_COUNT}: ${names.length}`);
  }
  const seen = new Set<string>();
  for (const name of names) {
    validateTemplateName(name);
    const duplicateKey = name.normalize('NFC').toLowerCase();
    if (seen.has(duplicateKey)) {
      throw new Error(`Duplicate template name: ${name}`);
    }
    seen.add(duplicateKey);
  }
}

function createZipRecord(file: PackFile, localOffset: number): ZipRecord {
  const name = Buffer.from(file.name, 'utf8');
  const checksum = crc32(file.bytes);
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(ZIP_LOCAL_FILE_HEADER, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(ZIP_UTF8_FLAG, 6);
  localHeader.writeUInt16LE(0, 8);
  localHeader.writeUInt16LE(0, 10);
  localHeader.writeUInt16LE(ZIP_DOS_EPOCH_DATE, 12);
  localHeader.writeUInt32LE(checksum, 14);
  localHeader.writeUInt32LE(file.bytes.byteLength, 18);
  localHeader.writeUInt32LE(file.bytes.byteLength, 22);
  localHeader.writeUInt16LE(name.byteLength, 26);
  localHeader.writeUInt16LE(0, 28);

  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(ZIP_CENTRAL_DIRECTORY_HEADER, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt16LE(ZIP_UTF8_FLAG, 8);
  centralHeader.writeUInt16LE(0, 10);
  centralHeader.writeUInt16LE(0, 12);
  centralHeader.writeUInt16LE(ZIP_DOS_EPOCH_DATE, 14);
  centralHeader.writeUInt32LE(checksum, 16);
  centralHeader.writeUInt32LE(file.bytes.byteLength, 20);
  centralHeader.writeUInt32LE(file.bytes.byteLength, 24);
  centralHeader.writeUInt16LE(name.byteLength, 28);
  centralHeader.writeUInt16LE(0, 30);
  centralHeader.writeUInt16LE(0, 32);
  centralHeader.writeUInt16LE(0, 34);
  centralHeader.writeUInt16LE(0, 36);
  centralHeader.writeUInt32LE(0, 38);
  centralHeader.writeUInt32LE(localOffset, 42);

  return {
    localFile: Buffer.concat([localHeader, name, file.bytes]),
    centralDirectory: Buffer.concat([centralHeader, name]),
  };
}

function createStoredZip(files: PackFile[]): Buffer {
  const records: ZipRecord[] = [];
  let localOffset = 0;

  for (const file of files) {
    if (file.bytes.byteLength > 0xffffffff) {
      throw new Error(`${file.name} exceeds the ZIP32 size limit`);
    }
    const record = createZipRecord(file, localOffset);
    records.push(record);
    localOffset += record.localFile.byteLength;
    if (localOffset > 0xffffffff) {
      throw new Error('Template content exceeds the ZIP32 archive size limit');
    }
  }

  const localFiles = Buffer.concat(records.map(({ localFile }) => localFile));
  const centralDirectory = Buffer.concat(records.map(({ centralDirectory }) => centralDirectory));
  if (centralDirectory.byteLength > 0xffffffff) {
    throw new Error('Template content exceeds the ZIP32 central-directory size limit');
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(ZIP_END_OF_CENTRAL_DIRECTORY, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.byteLength, 12);
  end.writeUInt32LE(localFiles.byteLength, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([localFiles, centralDirectory, end]);
}

function parseTableauBookmark(xml: string): ReturnType<DOMParser['parseFromString']> | undefined {
  const errors: string[] = [];
  try {
    const document = new DOMParser({
      onError: (_level, message) => errors.push(message),
    }).parseFromString(xml, 'application/xml');
    return errors.length === 0 && document.documentElement?.tagName === 'bookmark'
      ? document
      : undefined;
  } catch {
    return undefined;
  }
}

function normalizeSecurityName(value: string): string {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    // Malformed percent escapes cannot hide punctuation removed below.
  }
  return decoded.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
}

function isCredentialSecurityName(value: string): boolean {
  const normalized = normalizeSecurityName(value);
  return (
    CREDENTIAL_ATTRIBUTE_NAMES.has(normalized) ||
    CREDENTIAL_NAME_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
  );
}

function containsNonEmptyCredentialParameter(value: string): boolean {
  for (const match of value.matchAll(ATTRIBUTE_PARAMETER)) {
    if (isCredentialSecurityName(match[1] ?? '') && (match[2] ?? '').trim() !== '') {
      return true;
    }
  }
  return false;
}

function assertSafeTemplateContent(
  document: ReturnType<DOMParser['parseFromString']>,
  name: string,
): void {
  const elements = document.getElementsByTagName('*');
  for (let elementIndex = 0; elementIndex < elements.length; elementIndex += 1) {
    const attributes = elements.item(elementIndex)?.attributes;
    if (attributes === undefined) continue;
    for (let attributeIndex = 0; attributeIndex < attributes.length; attributeIndex += 1) {
      const attribute = attributes.item(attributeIndex);
      if (
        attribute !== null &&
        isCredentialSecurityName(attribute.name) &&
        attribute.value.trim() !== ''
      ) {
        throw new Error(
          `${name} contains a non-empty credential-like attribute: ${attribute.name}`,
        );
      }
      if (
        attribute !== null &&
        PATH_BEARING_ATTRIBUTE.test(attribute.name) &&
        ABSOLUTE_FILESYSTEM_PATH.test(attribute.value.trim())
      ) {
        throw new Error(`${name} contains an absolute local path`);
      }
      if (attribute !== null && containsNonEmptyCredentialParameter(attribute.value)) {
        throw new Error(
          `${name} contains a non-empty credential query value in attribute: ${attribute.name}`,
        );
      }
    }
  }
}

async function readRegularFile(path: string, name: string): Promise<Buffer> {
  const before = await lstat(path);
  if (!before.isFile()) {
    throw new Error(`${name} must be a regular file`);
  }
  if (before.size > MAX_TEMPLATE_BYTES) {
    throw new Error(`${name} exceeds ${MAX_TEMPLATE_BYTES} bytes`);
  }

  const handle = await open(path, 'r');
  try {
    const opened = await handle.stat();
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size > MAX_TEMPLATE_BYTES
    ) {
      if (opened.size > MAX_TEMPLATE_BYTES) {
        throw new Error(`${name} exceeds ${MAX_TEMPLATE_BYTES} bytes`);
      }
      throw new Error(`${name} changed while it was being packaged`);
    }

    const bytes = Buffer.allocUnsafe(MAX_TEMPLATE_BYTES + 1);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }

    const [openedAfterRead, after] = await Promise.all([handle.stat(), lstat(path)]);
    if (
      !openedAfterRead.isFile() ||
      !after.isFile() ||
      openedAfterRead.dev !== opened.dev ||
      openedAfterRead.ino !== opened.ino ||
      after.dev !== opened.dev ||
      after.ino !== opened.ino
    ) {
      throw new Error(`${name} changed while it was being packaged`);
    }
    if (
      offset > MAX_TEMPLATE_BYTES ||
      openedAfterRead.size > MAX_TEMPLATE_BYTES ||
      after.size > MAX_TEMPLATE_BYTES
    ) {
      throw new Error(`${name} exceeds ${MAX_TEMPLATE_BYTES} bytes`);
    }
    return bytes.subarray(0, offset);
  } finally {
    await handle.close();
  }
}

async function readTemplates(inputDir: string): Promise<PackFile[]> {
  const entries = await readdir(inputDir, { withFileTypes: true });
  const candidates = entries.filter(({ name }) => name.toLowerCase().endsWith('.tbm'));
  if (candidates.length === 0) {
    throw new Error(`${inputDir} contains no .tbm files`);
  }

  const templates: PackFile[] = [];
  candidates.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  validateTemplateNames(candidates.map(({ name }) => name));
  for (const entry of candidates) {
    const bytes = await readRegularFile(join(inputDir, entry.name), entry.name);
    let xml: string;
    try {
      xml = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new Error(`${entry.name} is not valid UTF-8 XML`);
    }
    const document = parseTableauBookmark(xml);
    if (document === undefined) {
      throw new Error(`${entry.name} is not a well-formed Tableau bookmark`);
    }
    assertSafeTemplateContent(document, entry.name);
    templates.push({ name: entry.name, bytes });
  }
  return templates;
}

export async function buildTemplateContentPack(
  options: BuildTemplateContentPackOptions,
): Promise<string> {
  validateVersion(options.version);
  const templates = await readTemplates(options.inputDir);
  const inventory = Buffer.from(
    `${JSON.stringify(
      {
        version: 1,
        files: templates.map(({ name, bytes }) => ({ name, sha256: sha256(bytes) })),
      },
      null,
      2,
    )}\n`,
  );
  if (inventory.byteLength > MAX_INTEGRITY_BYTES) {
    throw new Error(`Template integrity exceeds ${MAX_INTEGRITY_BYTES} bytes`);
  }
  const contentBytes = templates.reduce(
    (total, template) => total + template.bytes.byteLength,
    inventory.byteLength,
  );
  if (contentBytes > MAX_CONTENT_BYTES) {
    throw new Error(`Template content exceeds ${MAX_CONTENT_BYTES} bytes`);
  }
  const archive = createStoredZip([...templates, { name: INTEGRITY_NAME, bytes: inventory }]);
  await mkdir(options.outputDir, { recursive: true });
  const outputPath = join(options.outputDir, `${ARCHIVE_PREFIX}-${options.version}.zip`);
  const temporaryPath = join(options.outputDir, `.${ARCHIVE_PREFIX}-${randomUUID()}.tmp`);
  await writeFile(temporaryPath, archive, { flag: 'wx' });
  try {
    await rename(temporaryPath, outputPath);
  } finally {
    await unlink(temporaryPath).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    });
  }
  return outputPath;
}

async function main(): Promise<void> {
  const repoRoot = resolve(__dirname, '../..');
  const packageJson = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8')) as {
    version?: unknown;
  };
  if (typeof packageJson.version !== 'string') {
    throw new Error('package.json version must be a string');
  }
  const resolvedVersion = resolveTemplateContentPackVersion({
    args: process.argv.slice(2),
    environmentVersion: process.env.TEMPLATE_CONTENT_PACK_VERSION,
    packageVersion: packageJson.version,
  });
  const outputPath = await buildTemplateContentPack({
    inputDir: join(repoRoot, 'src/desktop/data/templates'),
    outputDir: join(repoRoot, 'build/template-content-pack'),
    version: resolvedVersion.version,
  });
  process.stdout.write(
    `Built template content pack ${resolvedVersion.version} from ${resolvedVersion.source}: ${outputPath}\n`,
  );
}

if (process.argv[1]?.endsWith('buildTemplateContentPack.ts')) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
