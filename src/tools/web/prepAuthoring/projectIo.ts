import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export const MAX_FILE = 32 * 1024 * 1024;
export const MAX_TOTAL = 64 * 1024 * 1024;
export const MAX_YAML = 1024 * 1024;
export const MAX_ITEMS = 100000;
export const MAX_ENTRIES = 4096;
export class AuthoringError extends Error {
  constructor(public readonly code = 'UNSAFE_PROJECT') {
    super(code);
  }
}
export const digest = (data: string | Buffer): string =>
  createHash('sha256').update(data).digest('hex');
export function entryName(name: string): string {
  if (
    !name ||
    name.length > 4096 ||
    /[\\:*?<>"|]/.test(name) ||
    [...name].some((character) => character.charCodeAt(0) < 32) ||
    name
      .split('/')
      .some(
        (p) =>
          !p ||
          p === '.' ||
          p === '..' ||
          /[. ]$/.test(p) ||
          /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(p),
      )
  )
    throw new AuthoringError();
  return name;
}
export function identity(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value))
    throw new AuthoringError();
  return value;
}
export class ProjectIo {
  readonly root: string;
  constructor(workspace: string) {
    if (
      !isAbsolute(workspace) ||
      /^(\\\\|\/\/)/.test(workspace) ||
      lstatSync(workspace).isSymbolicLink() ||
      !lstatSync(workspace).isDirectory()
    )
      throw new AuthoringError();
    this.root = realpathSync(workspace);
    if (resolve(workspace).toLowerCase() !== this.root.toLowerCase()) throw new AuthoringError();
  }
  check(path: string): void {
    const rel = relative(this.root, path);
    if (isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep)) throw new AuthoringError();
    for (let current = path; ; current = dirname(current)) {
      try {
        if (lstatSync(current).isSymbolicLink()) throw new AuthoringError();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      if (current === this.root) break;
      if (current === dirname(current)) throw new AuthoringError();
    }
    let existing = path;
    while (!existsSync(existing)) {
      if (existing === this.root) throw new AuthoringError();
      existing = dirname(existing);
    }
    const canonical = relative(this.root, realpathSync(existing));
    if (isAbsolute(canonical) || canonical === '..' || canonical.startsWith('..' + sep))
      throw new AuthoringError();
  }
  path(name: string, base = this.root): string {
    if (!name || name.length > 4096 || name.includes(':') || /^[\\/]/.test(name))
      throw new AuthoringError();
    const parts = name.replaceAll('\\', '/').split('/');
    if (parts.includes('..')) throw new AuthoringError();
    const normalized = parts.filter((part) => part !== '' && part !== '.').join('/');
    entryName(normalized);
    const path = join(base, ...normalized.split('/'));
    this.check(path);
    return path;
  }
  read(path: string, limit = MAX_FILE): Buffer {
    this.check(path);
    const before = lstatSync(path, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(Math.min(limit, MAX_TOTAL)))
      throw new AuthoringError();
    const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const opened = fstatSync(fd, { bigint: true });
      const same = (a: typeof before, b: typeof before): boolean =>
        a.dev === b.dev &&
        a.ino === b.ino &&
        a.size === b.size &&
        a.mtimeNs === b.mtimeNs &&
        b.nlink === 1n &&
        b.isFile();
      if (!same(before, opened)) throw new AuthoringError('SOURCE_CHANGED');
      const data = Buffer.alloc(Number(opened.size) + 1);
      let length = 0,
        count: number;
      while ((count = readSync(fd, data, length, data.length - length, null)) > 0) length += count;
      const after = fstatSync(fd, { bigint: true });
      if (
        length !== Number(opened.size) ||
        !same(opened, after) ||
        opened.ctimeNs !== after.ctimeNs ||
        !same(before, lstatSync(path, { bigint: true }))
      )
        throw new AuthoringError('SOURCE_CHANGED');
      this.check(path);
      return data.subarray(0, length);
    } finally {
      closeSync(fd);
    }
  }
  mkdir(path: string, exclusive = false): void {
    this.check(path);
    mkdirSync(path, { recursive: !exclusive, mode: 0o700 });
    this.check(path);
    if (!lstatSync(path).isDirectory()) throw new AuthoringError();
  }
  write(path: string, data: Buffer | string): void {
    this.mkdir(dirname(path));
    this.check(path);
    writeFileSync(path, data, { flag: 'wx', mode: 0o600 });
  }
  publish(path: string, data: Buffer): void {
    this.check(path);
    const temporary = join(dirname(path), '.prep-' + randomUUID());
    this.write(temporary, data);
    try {
      this.check(path);
      linkSync(temporary, path);
    } finally {
      unlinkSync(temporary);
    }
  }
  replacePrivate(path: string, data: string): void {
    this.read(path, MAX_YAML);
    const temporary = join(dirname(path), '.prep-' + randomUUID());
    this.write(temporary, data);
    try {
      this.check(path);
      renameSync(temporary, path);
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  }
  manifest(directory: string): { sha256: string; files: Record<string, string> } {
    const files: Record<string, string> = Object.create(null);
    let total = 0,
      count = 0;
    const visit = (path: string, depth: number): void => {
      this.check(path);
      if (++count > MAX_ENTRIES || depth > 100) throw new AuthoringError();
      const item = lstatSync(path);
      if (item.isDirectory()) {
        for (const name of readdirSync(path).sort()) visit(join(path, name), depth + 1);
      } else {
        const data = this.read(path, MAX_TOTAL - total);
        total += data.length;
        files[relative(directory, path).split(sep).join('/')] = digest(data);
      }
    };
    visit(directory, 0);
    return {
      sha256: digest(
        JSON.stringify(
          Object.fromEntries(
            Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
          ),
        ),
      ),
      files,
    };
  }
  copy(source: string, target: string): void {
    const before = this.manifest(source);
    for (const name of Object.keys(before.files))
      this.write(this.path(name, target), this.read(this.path(name, source), MAX_TOTAL));
    if (this.manifest(source).sha256 !== before.sha256) throw new AuthoringError('SOURCE_CHANGED');
  }
  exists(path: string): boolean {
    this.check(path);
    return existsSync(path);
  }
}
