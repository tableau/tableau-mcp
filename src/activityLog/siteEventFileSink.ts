import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, truncateSync } from 'node:fs';
import { join } from 'node:path';

import { getExceptionMessage } from '../utils/getExceptionMessage.js';
import { CeppLogger } from './sdkTypes.js';

/** `{service}-cepp-site.log`, the file name the CEPP log shipper tails. */
export const SITE_EVENT_FILE_NAME = 'tableau-mcp-cepp-site.log';

// The rsyslog sidecar silently drops lines over its 15k maxMessageSize, so drop them here where
// it can be logged. 15,000 holds whether the sidecar reads "15k" as 15,000 or 15,360.
export const MAX_LINE_BYTES = 15_000;

export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_ROTATED_FILES = 5;

type SiteEventFileSinkOptions = {
  directory: string;
  /** Where the sink reports dropped lines and write or rotation failures. */
  diagnostics: CeppLogger;
  maxLineBytes?: number;
  maxFileBytes?: number;
  maxRotatedFiles?: number;
};

/**
 * The CEPP SDK's site logger: appends each event record as one line of
 * `<directory>/tableau-mcp-cepp-site.log` for the log shipper to forward to Activity Log.
 *
 * Writes are synchronous because the SDK's logger interface is: a failed append then reaches the
 * SDK recorder, which suppresses and reports it, and lines stay whole and ordered without a queue.
 * Rotation renames the file, so a shipper following it by inode reads the old file to its end.
 */
export class SiteEventFileSink implements CeppLogger {
  readonly filePath: string;
  private readonly _diagnostics: CeppLogger;
  private readonly _maxLineBytes: number;
  private readonly _maxFileBytes: number;
  private readonly _maxRotatedFiles: number;
  private _fileBytes: number;
  private _rotateAtBytes: number;
  // Set when a failed append may have left part of a line that couldn't be truncated away.
  private _startWithNewline = false;

  constructor({
    directory,
    diagnostics,
    maxLineBytes = MAX_LINE_BYTES,
    maxFileBytes = MAX_FILE_BYTES,
    maxRotatedFiles = MAX_ROTATED_FILES,
  }: SiteEventFileSinkOptions) {
    mkdirSync(directory, { recursive: true });
    this.filePath = join(directory, SITE_EVENT_FILE_NAME);
    this._diagnostics = diagnostics;
    this._maxLineBytes = maxLineBytes;
    this._maxFileBytes = maxFileBytes;
    this._maxRotatedFiles = maxRotatedFiles;
    this._fileBytes = existsSync(this.filePath) ? statSync(this.filePath).size : 0;
    this._rotateAtBytes = maxFileBytes;
  }

  info(message: string): void {
    const line = `${message}\n`;
    const lineBytes = Buffer.byteLength(line);
    if (lineBytes > this._maxLineBytes) {
      this._diagnostics.warn(
        `Activity Log event dropped: its record is ${lineBytes} bytes, over the ${this._maxLineBytes}-byte line limit`,
      );
      return;
    }

    if (this._fileBytes > 0 && this._fileBytes + lineBytes > this._rotateAtBytes) {
      this._rotate();
    }

    const data = this._startWithNewline ? `\n${line}` : line;
    try {
      appendFileSync(this.filePath, data);
    } catch (error) {
      this._discardPartialWrite();
      throw error;
    }
    this._fileBytes += Buffer.byteLength(data);
    this._startWithNewline = false;
  }

  warn(message: string): void {
    this._diagnostics.warn(message);
  }

  error(message: string): void {
    this._diagnostics.error(message);
  }

  // A failed append (e.g. ENOSPC) can leave part of a line behind, and the next record would be
  // joined onto it, corrupting both.
  private _discardPartialWrite(): void {
    try {
      if (existsSync(this.filePath) && statSync(this.filePath).size > this._fileBytes) {
        truncateSync(this.filePath, this._fileBytes);
      }
    } catch {
      this._startWithNewline = true;
    }
  }

  private _rotate(): void {
    try {
      for (let i = this._maxRotatedFiles - 1; i >= 1; i--) {
        const from = `${this.filePath}.${i}`;
        if (existsSync(from)) {
          renameSync(from, `${this.filePath}.${i + 1}`);
        }
      }
      renameSync(this.filePath, `${this.filePath}.1`);
      this._fileBytes = 0;
      this._rotateAtBytes = this._maxFileBytes;
    } catch (error) {
      // Keep appending rather than lose events, and wait another full file before retrying so a
      // persistent failure isn't reported on every call.
      this._rotateAtBytes = this._fileBytes + this._maxFileBytes;
      this._diagnostics.error(`Activity Log file rotation failed: ${getExceptionMessage(error)}`);
    }
  }
}
