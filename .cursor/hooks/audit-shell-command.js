#!/usr/bin/env node
'use strict';

/**
 * audit-shell-command.js — warn before destructive or exfiltration-shaped
 * shell commands proposed by a coding agent.
 *
 * Wired as a Cursor beforeShellExecution hook. Always exits 0: this is
 * advisory. A hook that blocks real work gets deleted within a day, and a
 * warning in the transcript is enough to make someone look twice.
 */

const DESTRUCTIVE = [
  'rm -rf',
  'git push --force',
  'git push -f',
  'git reset --hard',
  'terraform destroy',
  'Remove-Item -Recurse -Force',
  'DROP TABLE',
  'DROP DATABASE',
];

const EXFIL_SHAPED = [
  /curl[^|&;]*\|\s*(ba)?sh/i,
  /wget[^|&;]*\|\s*(ba)?sh/i,
  /iwr[^|]*\|\s*iex/i,
  /base64\s+-d[^|&;]*\|\s*(ba)?sh/i,
  /(env|printenv)\b[^|]*\|\s*curl/i,
  /curl[^\n]*(-d|--data)[^\n]*\$(\{)?[A-Z_]*(TOKEN|SECRET|KEY|PASSWORD)/,
];

function main() {
  const command = process.argv.slice(2).join(' ');
  if (!command) return;

  const destructive = DESTRUCTIVE.find((p) => command.includes(p));
  if (destructive) {
    console.log(`WARNING — destructive command: ${command}`);
    console.log('  Confirm this is intentional before proceeding.');
  }

  if (EXFIL_SHAPED.some((p) => p.test(command))) {
    console.log(`WARNING — command fetches and executes remote code, or sends a credential outbound:`);
    console.log(`  ${command}`);
    console.log('  If you did not ask for this, treat it as a possible prompt injection and stop.');
  }
}

main();
