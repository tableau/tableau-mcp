import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  COMPOSER_SELECTOR,
  PERFORMANCE_PROMPT,
  redactSecrets,
  SEND_SELECTOR,
  STOP_SELECTOR,
  validateUiCdpReport,
} from './smoke-contracts.mjs';

function argsMap(argv: string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error(`expected --name value arguments, received ${key ?? '(end)'}`);
    }
    values.set(key.slice(2), value);
  }
  return values;
}

function pollingExpression(
  selector: string,
  timeoutMs: number,
  phase: string,
  predicate: string,
): string {
  return `(async () => {
    const deadline = Date.now() + ${timeoutMs};
    while (Date.now() < deadline) {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (element && (${predicate})) return { phase: ${JSON.stringify(phase)}, ok: true };
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return { phase: ${JSON.stringify(phase)}, ok: false, selector: ${JSON.stringify(selector)} };
  })()`;
}

async function generate(values: Map<string, string>): Promise<void> {
  const output = resolve(values.get('output') ?? 'ui-cdp-spec.json');
  const url = values.get('url') ?? 'http://localhost:8081/#live-dev';
  const prompt = values.get('prompt') ?? PERFORMANCE_PROMPT;
  const timeoutMs = Number(values.get('timeout-ms') ?? '900000');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 5_000) {
    throw new Error('--timeout-ms must be an integer of at least 5000');
  }
  const fill = `(() => {
    const element = document.querySelector(${JSON.stringify(COMPOSER_SELECTOR)});
    if (!(element instanceof HTMLElement)) return { phase: 'composer-filled', ok: false };
    element.focus();
    element.textContent = ${JSON.stringify(prompt)};
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(prompt)} }));
    return { phase: 'composer-filled', ok: element.textContent === ${JSON.stringify(prompt)}, text: element.textContent };
  })()`;
  const setYolo = `(() => {
    const element = document.querySelector('[data-tb-test-id="south-mode-btn-yolo"]');
    if (!(element instanceof HTMLButtonElement)) return { phase: 'permission-mode', ok: true, changed: false, reason: 'not-rendered' };
    if (element.getAttribute('aria-pressed') !== 'true' && !element.disabled) element.click();
    return { phase: 'permission-mode', ok: !element.disabled, changed: true };
  })()`;
  const submit = `(() => {
    const element = document.querySelector(${JSON.stringify(SEND_SELECTOR)});
    if (!(element instanceof HTMLButtonElement) || element.disabled) return { phase: 'prompt-submitted', ok: false };
    element.click();
    return { phase: 'prompt-submitted', ok: true };
  })()`;
  const transcript = `(() => ({
    phase: 'transcript',
    href: location.href,
    text: document.querySelector('#chat-log')?.textContent ?? document.body.textContent ?? ''
  }))()`;
  const spec = {
    url,
    wait: 7_000,
    steps: [
      {
        eval: `(() => ({ phase: 'page-preflight', ok: location.hash === '#live-dev' && !!document.querySelector(${JSON.stringify(COMPOSER_SELECTOR)}), href: location.href }))()`,
      },
      { shot: 'before' },
      { eval: setYolo },
      { eval: fill },
      { shot: 'submitted' },
      { eval: submit },
      {
        eval: pollingExpression(
          STOP_SELECTOR,
          Math.min(timeoutMs, 60_000),
          'stop-selector-seen',
          'true',
        ),
      },
      {
        eval: pollingExpression(
          SEND_SELECTOR,
          timeoutMs,
          'turn-completed',
          `!(element instanceof HTMLButtonElement) || (!element.disabled && !document.querySelector(${JSON.stringify(STOP_SELECTOR)}))`,
        ),
      },
      { shot: 'completed' },
      { eval: transcript },
    ],
  };
  await writeFile(output, `${JSON.stringify(spec, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ output, url, prompt })}\n`);
}

async function parseReport(values: Map<string, string>): Promise<void> {
  const reportPath = resolve(values.get('parse-report') ?? '');
  const output = resolve(values.get('output') ?? 'ui-cdp-result.json');
  const prompt = values.get('prompt') ?? PERFORMANCE_PROMPT;
  const raw: unknown = JSON.parse(await readFile(reportPath, 'utf8'));
  const evidence = validateUiCdpReport(raw, prompt);
  const result = redactSecrets({
    success: evidence.success,
    evidence,
    reportPath,
    finishedAt: new Date().toISOString(),
  });
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!evidence.success) process.exitCode = 1;
}

const values = argsMap(process.argv.slice(2));
(values.has('parse-report') ? parseReport(values) : generate(values)).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
