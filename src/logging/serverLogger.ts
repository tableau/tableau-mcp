import { appendFile } from 'node:fs/promises';

import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

import { getExceptionMessage } from '../utils/getExceptionMessage.js';
import { writeToStderr } from './log.js';

export class ServerLogger {
  private readonly _logDirectory: string;
  private readonly _fileMutexes = new Map<string, Promise<void>>();

  constructor({ logDirectory }: { logDirectory: string }) {
    this._logDirectory = logDirectory;

    if (!existsSync(this._logDirectory)) {
      mkdirSync(this._logDirectory, { recursive: true });
    }
  }

  async log(obj: Record<string, unknown>): Promise<void> {
    // Create a new log file each hour e.g. 2025-10-15T21-00-00-000Z.log
    const timestamp = new Date().toISOString();
    const filename = `${new Date(new Date().setMinutes(0, 0, 0)).toISOString().replace(/[:.]/g, '-')}.log`;
    const logFilePath = join(this._logDirectory, filename);

    // Get or create a mutex for this specific log file
    const mutexKey = logFilePath;
    const currentMutex = this._fileMutexes.get(mutexKey) ?? Promise.resolve();

    // Chain the file write operation after the current mutex
    const newMutex = currentMutex.then(async () => {
      try {
        // appendFile will create the file if it doesn't exist
        await appendFile(logFilePath, JSON.stringify({ timestamp, ...obj }) + '\n');
      } catch (error) {
        writeToStderr(`Failed to write to log file ${logFilePath}: ${getExceptionMessage(error)}`);
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
