import {
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  rmdirSync,
  type Stats,
  statSync,
  unlinkSync,
} from 'node:fs';

export interface FileSystem {
  lstat(path: string): Stats;
  realpath(path: string): string;
  stat(path: string): Stats;
  readdir(path: string): string[];
  open(path: string, flags: number): number;
  fstat(fd: number): Stats;
  /** Returns at most maxBytes + 1 so callers can detect an oversized or growing file. */
  read(fd: number, maxBytes: number): Buffer;
  close(fd: number): void;
  unlink(path: string): void;
  rmdir(path: string): void;
}

export const NODE_FILE_SYSTEM: FileSystem = {
  lstat: lstatSync,
  realpath: realpathSync,
  stat: statSync,
  readdir: (path) => readdirSync(path),
  open: openSync,
  fstat: fstatSync,
  read: (fd, maxBytes) => {
    const bytes = Buffer.allocUnsafe(maxBytes + 1);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const count = readSync(fd, bytes, offset, bytes.byteLength - offset, null);
      if (count === 0) break;
      offset += count;
    }
    return bytes.subarray(0, offset);
  },
  close: closeSync,
  unlink: unlinkSync,
  rmdir: rmdirSync,
};
