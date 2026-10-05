import { appendFile } from 'node:fs/promises';

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
