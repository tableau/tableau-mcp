import { appendFile, readdir, unlink } from 'node:fs/promises';

import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

import { getExceptionMessage } from '../utils/getExceptionMessage.js';
import type { LogEntry } from './types.js';

let _fileLogger: FileLogger | undefined;

export const setFileLogger = (logger: FileLogger): void => {
  _fileLogger = logger;
};

export const getFileLogger = (): FileLogger | undefined => _fileLogger;

export class FileLogger {
  private readonly _logDirectory: string;
  private readonly _fileNamePrefix: string;
  private readonly _fileMutexes = new Map<string, Promise<void>>();

  constructor({
    logDirectory,
    fileNamePrefix = '',
  }: {
    logDirectory: string;
    fileNamePrefix?: string;
  }) {
    this._logDirectory = logDirectory;
    this._fileNamePrefix = fileNamePrefix;

    if (!existsSync(this._logDirectory)) {
      mkdirSync(this._logDirectory, { recursive: true });
    }
  }

  async log(entry: LogEntry): Promise<void> {
    // Create a new log file each hour e.g. 2025-10-15T21-00-00-000Z.log
    const timestamp = new Date().toISOString();
    const filename = `${this._fileNamePrefix}${new Date(new Date().setMinutes(0, 0, 0)).toISOString().replace(/[:.]/g, '-')}.log`;
    await this.appendJsonLine(filename, { timestamp, ...entry });
  }

  /**
   * Delete this logger's own hourly files older than `maxAgeDays`. Opt-in and prefix-scoped so
   * unprefixed (web) logs and other files in the directory are never touched. Never throws.
   */
  async pruneOldLogs({
    maxAgeDays,
    now = new Date(),
  }: {
    maxAgeDays: number;
    now?: Date;
  }): Promise<void> {
    if (!Number.isFinite(maxAgeDays) || maxAgeDays <= 0 || this._fileNamePrefix === '') {
      return;
    }

    let names: Array<string>;
    try {
      names = await readdir(this._logDirectory);
    } catch (error) {
      process.stderr.write(
        `Failed to list log directory ${this._logDirectory}: ${getExceptionMessage(error)}\n`,
      );
      return;
    }

    const escapedPrefix = this._fileNamePrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const hourFile = new RegExp(
      `^${escapedPrefix}(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2})-(\\d{2})-00-000Z\\.log$`,
    );
    const cutoff = now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000;
    // Same local rounding as log(), so the file being written now is never pruned (half-hour zones).
    const currentFileStart = new Date(now.getTime()).setMinutes(0, 0, 0);

    const failures: Array<{ name: string; code: string }> = [];
    await Promise.all(
      names.map(async (name) => {
        const match = hourFile.exec(name);
        if (!match) return;

        const [year, month, day, hour, minute] = match.slice(1).map(Number);
        const fileStart = Date.UTC(year, month - 1, day, hour, minute);
        if (fileStart >= currentFileStart || fileStart >= cutoff) return;

        try {
          await unlink(join(this._logDirectory, name));
        } catch (error) {
          // Concurrent desktop processes race on the same files; a lost race is fine.
          const code = (error as NodeJS.ErrnoException | undefined)?.code;
          if (code !== 'ENOENT') {
            failures.push({ name, code: code ?? getExceptionMessage(error) });
          }
        }
      }),
    );

    if (failures.length > 0) {
      const [first] = failures;
      process.stderr.write(
        `Failed to delete ${failures.length} old log file(s) in ${this._logDirectory}; first: ${first.name} (${first.code})\n`,
      );
    }
  }

  async appendJsonLine(filename: string, entry: Record<string, unknown>): Promise<void> {
    const logFilePath = join(this._logDirectory, filename);
    // Get or create a mutex for this specific log file
    const mutexKey = logFilePath;
    const currentMutex = this._fileMutexes.get(mutexKey) ?? Promise.resolve();

    // Chain the file write operation after the current mutex
    const newMutex = currentMutex.then(async () => {
      try {
        // appendFile will create the file if it doesn't exist
        await appendFile(logFilePath, JSON.stringify(entry) + '\n');
      } catch (error) {
        process.stderr.write(
          `Failed to write to log file ${logFilePath}: ${getExceptionMessage(error)}\n`,
        );
      }
    });

    this._fileMutexes.set(mutexKey, newMutex);

    // Clean up completed mutexes to prevent memory leaks
    newMutex.finally(() => {
      if (this._fileMutexes.get(mutexKey) === newMutex) {
        this._fileMutexes.delete(mutexKey);
      }
    });

    // Wait for the file write operation to complete
    await newMutex;
  }
}
