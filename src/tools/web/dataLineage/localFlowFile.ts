import { constants, Stats } from 'node:fs';
import { basename, extname, isAbsolute, relative, resolve, sep } from 'node:path';

import {
  FlowPackageDocument,
  MAX_FLOW_FILE_BYTES,
  parseFlowPackage,
} from '../../../sdks/tableau/methods/flowPackage.js';
import { FileSystem, NODE_FILE_SYSTEM } from '../../../utils/fileSystem.js';

export class LocalFlowAccessError extends Error {
  constructor(readonly code: 'NOT_ALLOWED' | 'UNAVAILABLE') {
    super('The local flow source could not be read within the configured access boundary.');
  }
}
const networkPath = (value: string): boolean => value.startsWith('\\\\') || value.startsWith('//');
const contained = (root: string, target: string): boolean => {
  const rel = relative(root, target);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};
const sameFile = (left: Stats, right: Stats): boolean =>
  left.dev === right.dev &&
  left.ino === right.ino &&
  left.size === right.size &&
  left.mtimeMs === right.mtimeMs &&
  left.ctimeMs === right.ctimeMs;
const regular = (value: Stats): boolean =>
  value.isFile() &&
  !value.isSymbolicLink() &&
  value.nlink === 1 &&
  value.size > 0 &&
  value.size <= MAX_FLOW_FILE_BYTES;

/** Stdio and operator-owned roots only. No extraction, remote paths or writes. */
export function readLocalFlowFile(
  path: string,
  config: { transport: string; localFlowRoots?: string[] },
  fs: FileSystem = NODE_FILE_SYSTEM,
): FlowPackageDocument & { name: string } {
  if (
    config.transport !== 'stdio' ||
    !config.localFlowRoots?.length ||
    !isAbsolute(path) ||
    networkPath(path) ||
    !['.tfl', '.tflx'].includes(extname(path).toLowerCase()) ||
    (process.platform === 'win32' && path.slice(2).includes(':'))
  )
    throw new LocalFlowAccessError('NOT_ALLOWED');
  const roots = config.localFlowRoots
    .filter((root) => isAbsolute(root) && !networkPath(root))
    .map((root) => resolve(root));
  if (!roots.some((root) => contained(root, resolve(path))))
    throw new LocalFlowAccessError('NOT_ALLOWED');
  let fd: number | undefined;
  try {
    const real = fs.realpath(path);
    const permitted = roots.some((root) => {
      const actual = fs.realpath(root);
      return fs.stat(actual).isDirectory() && contained(actual, real);
    });
    if (!permitted) throw new LocalFlowAccessError('NOT_ALLOWED');
    const expected = fs.lstat(path);
    if (!regular(expected)) throw new LocalFlowAccessError('UNAVAILABLE');
    fd = fs.open(real, constants.O_RDONLY);
    const opened = fs.fstat(fd);
    if (!regular(opened) || !sameFile(expected, opened))
      throw new LocalFlowAccessError('UNAVAILABLE');
    const bytes = fs.read(fd, MAX_FLOW_FILE_BYTES);
    if (
      bytes.length !== opened.size ||
      bytes.length > MAX_FLOW_FILE_BYTES ||
      !sameFile(opened, fs.fstat(fd)) ||
      relative(real, fs.realpath(path)) !== '' ||
      !sameFile(opened, fs.stat(real)) ||
      fs.lstat(path).isSymbolicLink()
    )
      throw new LocalFlowAccessError('UNAVAILABLE');
    const result = { ...parseFlowPackage(bytes), name: basename(path) };
    fs.close(fd);
    fd = undefined;
    return result;
  } catch (error) {
    if (fd !== undefined) {
      try {
        fs.close(fd);
      } catch {
        // Preserve the generic boundary error without leaking filesystem details.
      }
    }
    if (error instanceof LocalFlowAccessError) throw error;
    throw new LocalFlowAccessError('UNAVAILABLE');
  }
}
