import * as fs from 'fs';
import * as path from 'path';

import { readDesktopCommandError, snapshotDesktopLogs } from './desktopLogError.js';

const PID = 63475;
const STARTED_AT = new Date('2026-07-28T16:33:30.000');

function record(value: Record<string, unknown>): string {
  return `${JSON.stringify(value)}\n`;
}

describe('desktopLogError', () => {
  let logDir: string;
  let logPath: string;

  beforeEach(() => {
    logDir = fs.mkdtempSync(path.join(process.cwd(), '.desktop-log-error-test-'));
    logPath = path.join(logDir, 'log_2.txt');
    fs.writeFileSync(
      logPath,
      record({ ts: '2026-07-28T16:33:29.000', pid: PID, k: 'msg', v: 'before' }),
    );
  });

  afterEach(() => {
    fs.rmSync(logDir, { recursive: true, force: true });
  });

  it('extracts the Desktop parameter message and detailed-dialog error code', () => {
    const cursor = snapshotDesktopLogs({ pid: PID, candidateDirs: [logDir] });
    fs.appendFileSync(
      logPath,
      [
        record({
          ts: '2026-07-28T16:33:30.929',
          pid: PID,
          k: 'begin-commands-controller.invoke-command',
          a: { id: 'command-id' },
          v: { name: 'tabdoc:edit-calc', args: 'tabdoc:edit-calc field-name="A"' },
        }),
        record({
          ts: '2026-07-28T16:33:30.929',
          pid: PID,
          k: 'msg',
          v: "Error in parameters for command 'edit-calc'\nmissing: fn\n",
        }),
        record({
          ts: '2026-07-28T16:33:30.930',
          pid: PID,
          k: 'begin-commands-controller.invoke-command',
          a: { sponsor: 'command-id' },
          v: {
            name: 'tabdoc:show-detailed-error-dialog',
            args: 'tabdoc:show-detailed-error-dialog error-short-message="Error in parameters for command \'edit-calc\'missing: fn" error-help-link="https://help.tableau.com/?errorcode=47bf7751"',
          },
        }),
      ].join(''),
    );

    const result = readDesktopCommandError({
      cursor,
      pid: PID,
      namespace: 'tabdoc',
      command: 'edit-calc',
      startedAt: STARTED_AT,
    });

    expect(result.logDetail).toBe('found');
    expect(result.detail).toMatchObject({
      message: "Error in parameters for command 'edit-calc'\nmissing: fn",
      code: '47BF7751',
      source: 'tableau-desktop-log',
      logPath,
      timestamp: '2026-07-28T16:33:30.929',
    });
  });

  it('ignores matching records from another pid and before command start', () => {
    const cursor = snapshotDesktopLogs({ pid: PID, candidateDirs: [logDir] });
    fs.appendFileSync(
      logPath,
      [
        record({
          ts: '2026-07-28T16:33:30.929',
          pid: PID + 1,
          k: 'msg',
          v: "Error in parameters for command 'edit-calc'\nwrong pid",
        }),
        record({
          ts: '2026-07-28T16:33:20.000',
          pid: PID,
          k: 'msg',
          v: "Error in parameters for command 'edit-calc'\nstale",
        }),
      ].join(''),
    );

    expect(
      readDesktopCommandError({
        cursor,
        pid: PID,
        namespace: 'tabdoc',
        command: 'edit-calc',
        startedAt: STARTED_AT,
      }),
    ).toEqual({ detail: null, logDetail: 'not-found' });
  });

  it('extracts the detailed-error-msg carrier', () => {
    const cursor = snapshotDesktopLogs({ pid: PID, candidateDirs: [logDir] });
    fs.appendFileSync(
      logPath,
      record({
        ts: '2026-07-28T16:33:30.929',
        pid: PID,
        k: 'detailed-error-msg',
        v: {
          shortMessage: "Command 'edit-calc' rejected the formula",
          supportUrl: 'https://help.tableau.com/?errorcode=abc123',
        },
      }),
    );

    const result = readDesktopCommandError({
      cursor,
      pid: PID,
      namespace: 'tabdoc',
      command: 'edit-calc',
      startedAt: STARTED_AT,
    });

    expect(result.detail).toMatchObject({
      message: "Command 'edit-calc' rejected the formula",
      code: 'ABC123',
    });
  });

  it('extracts the correlated command-end carrier', () => {
    const cursor = snapshotDesktopLogs({ pid: PID, candidateDirs: [logDir] });
    fs.appendFileSync(
      logPath,
      [
        record({
          ts: '2026-07-28T16:33:30.929',
          pid: PID,
          k: 'begin-commands-controller.invoke-command',
          a: { id: 'command-id' },
          v: { name: 'tabdoc:edit-calc' },
        }),
        record({
          ts: '2026-07-28T16:33:30.930',
          pid: PID,
          k: 'end-commands-controller.invoke-command',
          a: { id: 'command-id', rv: { msg: 'Calculation failed', 'e-code': '47bf7751' } },
        }),
      ].join(''),
    );

    const result = readDesktopCommandError({
      cursor,
      pid: PID,
      namespace: 'tabdoc',
      command: 'edit-calc',
      startedAt: STARTED_AT,
    });

    expect(result.detail).toMatchObject({ message: 'Calculation failed', code: '47BF7751' });
  });

  it('follows a same-inode rotation and ignores a malformed final line', () => {
    const cursor = snapshotDesktopLogs({ pid: PID, candidateDirs: [logDir] });
    const rotatedPath = path.join(logDir, 'log_2_bk.txt');
    fs.renameSync(logPath, rotatedPath);
    fs.appendFileSync(
      rotatedPath,
      record({
        ts: '2026-07-28T16:33:30.929',
        pid: PID,
        k: 'msg',
        v: "Error in parameters for command 'edit-calc'\nmissing: fn",
      }) + '{"partial":',
    );

    const result = readDesktopCommandError({
      cursor,
      pid: PID,
      namespace: 'tabdoc',
      command: 'edit-calc',
      startedAt: STARTED_AT,
    });

    expect(result.logDetail).toBe('found');
    expect(result.detail?.logPath).toBe(rotatedPath);
  });

  it('degrades to unavailable without readable log files', () => {
    const cursor = snapshotDesktopLogs({
      pid: PID,
      candidateDirs: [path.join(logDir, 'missing')],
    });

    expect(
      readDesktopCommandError({
        cursor,
        pid: PID,
        namespace: 'tabdoc',
        command: 'edit-calc',
        startedAt: STARTED_AT,
      }),
    ).toEqual({ detail: null, logDetail: 'unavailable' });
  });
});
