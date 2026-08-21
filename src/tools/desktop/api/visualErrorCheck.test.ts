import { encode as encodePng } from 'fast-png';
import { readFileSync, statSync } from 'fs';
import { Err, Ok } from 'ts-results-es';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ExecuteCommandError } from '../../../desktop/externalApi/executorTypes.js';
import { runVisualErrorCheck, runVisualErrorCheckText } from './visualErrorCheck.js';

// runVisualErrorCheck resolves the chosen capture through chooseMainWindowImage, which reads
// files off disk; stub statSync/readFileSync so the synthetic PNG stands in for a real capture.
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    statSync: vi.fn(),
    readFileSync: vi.fn(),
    readdirSync: vi.fn(),
  };
});

const ERROR_RED: [number, number, number] = [190, 40, 40];
const WHITE: [number, number, number] = [255, 255, 255];

function makePng(
  width: number,
  height: number,
  paint: (x: number, y: number) => [number, number, number],
): Buffer {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y);
      const p = (y * width + x) * 3;
      data[p] = r;
      data[p + 1] = g;
      data[p + 2] = b;
    }
  }
  return Buffer.from(encodePng({ width, height, channels: 3, depth: 8, data }));
}

// A capture with a solid red pill on an otherwise white window — a dense cluster the density
// triage flags. A clean capture is all white.
const REDDISH_PNG = makePng(96, 54, (x, y) =>
  x >= 10 && x < 40 && y >= 10 && y < 30 ? ERROR_RED : WHITE,
);
const CLEAN_PNG = makePng(96, 54, () => WHITE);

// An executor whose take-all-screenshots call resolves to one PNG on disk (bytes), or errors.
function executorReturning(bytes: Buffer | { error: ExecuteCommandError }): {
  executeCommand: ReturnType<typeof vi.fn>;
} {
  if ('error' in bytes) {
    return { executeCommand: vi.fn().mockResolvedValue(Err(bytes.error)) };
  }
  vi.mocked(statSync).mockImplementation((() => ({
    size: bytes.length,
    isDirectory: () => false,
  })) as never);
  vi.mocked(readFileSync).mockImplementation((() => bytes) as never);
  return {
    executeCommand: vi.fn().mockResolvedValue(Ok({ result: { TempFilePath: '/tmp/shot.png' } })),
  };
}

describe('runVisualErrorCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a visual warning naming capture-window-screenshot when the window is densely red', async () => {
    const executor = executorReturning(REDDISH_PNG);

    const finding = await runVisualErrorCheck({
      executor: executor as never,
      signal: new AbortController().signal,
    });

    expect(finding).not.toBeNull();
    expect(finding?.severity).toBe('warning');
    expect(finding?.source).toBe('visual');
    expect(finding?.message).toMatch(/capture-window-screenshot/);
    expect(finding?.message).toMatch(/%/);
    // The finding pins no evidence handle yet — a live re-capture shows the persistent pill.
    expect(finding?.evidence).toBeUndefined();
  });

  it('returns null on a clean (non-red) window', async () => {
    const executor = executorReturning(CLEAN_PNG);

    const finding = await runVisualErrorCheck({
      executor: executor as never,
      signal: new AbortController().signal,
    });

    expect(finding).toBeNull();
  });

  it('returns null (never throws) when the capture is unavailable', async () => {
    const executor = executorReturning({
      error: {
        type: 'command-failed',
        error: { code: 'busy', message: 'Desktop busy', recoverable: true },
      },
    });

    const finding = await runVisualErrorCheck({
      executor: executor as never,
      signal: new AbortController().signal,
    });

    expect(finding).toBeNull();
  });

  it('returns null when the captured bytes cannot be decoded as a PNG', async () => {
    const executor = executorReturning(Buffer.from('not a png'));

    const finding = await runVisualErrorCheck({
      executor: executor as never,
      signal: new AbortController().signal,
    });

    expect(finding).toBeNull();
  });
});

describe('runVisualErrorCheckText', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty and never captures when disabled', async () => {
    const executor = { executeCommand: vi.fn() };

    const text = await runVisualErrorCheckText({
      executor: executor as never,
      signal: new AbortController().signal,
      enabled: false,
    });

    expect(text).toBe('');
    expect(executor.executeCommand).not.toHaveBeenCalled();
  });

  it('renders the visual-check warning text when enabled and the window is densely red', async () => {
    const executor = executorReturning(REDDISH_PNG);

    const text = await runVisualErrorCheckText({
      executor: executor as never,
      signal: new AbortController().signal,
      enabled: true,
    });

    expect(text).toMatch(/⚠️ Visual check —/);
    expect(text).toMatch(/capture-window-screenshot/);
  });

  it('returns empty when enabled but the window is clean', async () => {
    const executor = executorReturning(CLEAN_PNG);

    const text = await runVisualErrorCheckText({
      executor: executor as never,
      signal: new AbortController().signal,
      enabled: true,
    });

    expect(text).toBe('');
  });
});
