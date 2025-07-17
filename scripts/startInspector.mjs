import { spawn } from 'child_process';
import open from 'open';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

const argv = yargs(hideBin(process.argv))
  .option('transport', {
    alias: 't',
    type: 'string',
    describe: 'MCP transport to use',
    choices: ['stdio', 'http'],
    default: 'stdio',
  })
  .option('docker', {
    alias: 'd',
    type: 'boolean',
    describe: 'Use Docker to run the inspector',
    default: false,
  })
  .help('help')
  .parse();

// Don't auto-open the inspector in the browser.
// We'll append the prefill arguments and open it ourselves.
process.env.MCP_AUTO_OPEN_ENABLED = 'false';

const commandParts = ['script', 'inspect'];
if (argv.docker) commandParts.push('docker');
if (argv.transport === 'http') commandParts.push('http');

// Spawn the corresponding NPM script and capture its output
const child = spawn('npm', ['run', commandParts.join(':')], {
  stdio: ['inherit', 'pipe', 'pipe'],
  shell: true,
});

let expressUrl = null;
child.stdout.on('data', (data) => {
  const text = data.toString();

  if (argv.transport === 'http') {
    // Capture the URL of the Express server
    const matchExpress = text.match(
      /tableau-mcp v([\d\\.]+) stateless streamable HTTP server available at http:\/\/localhost:(\d+)\/tableau-mcp/,
    );

    if (matchExpress) {
      expressUrl = `http://localhost:${matchExpress[2]}/tableau-mcp`;
    }
  }

  // Capture the URL of the inspector
  const matchInspector = text.match(/http:\/\/localhost:6274\/\?MCP_PROXY_AUTH_TOKEN=(\S+)/);
  if (matchInspector) {
    const url = new URL(matchInspector[0]);

    if (argv.transport === 'http') {
      if (!expressUrl) {
        console.error(
          '❌ Failed to previously parse the URL of the Express server! Did it start? Was it already running?',
        );
      }

      url.searchParams.set('transport', 'streamable-http');
      url.searchParams.set('serverUrl', expressUrl);
    } else {
      url.searchParams.set('transport', 'stdio');
      if (argv.docker) {
        url.searchParams.set('serverCommand', 'docker');
        url.searchParams.set('serverArgs', 'run -i --rm --env-file env.list tableau-mcp');
      } else {
        url.searchParams.set('serverCommand', 'node');
        url.searchParams.set('serverArgs', 'build/index.js');
      }
    }

    console.log(`🚀 MCP Inspector is up and running at: ${url.toString()}`);
    open(url.toString());
  } else {
    console.log(text);
  }
});

child.stderr.on('data', (data) => console.error(data.toString()));
child.on('close', (code) => console.log(`Inspector process exited with code ${code}`));
child.on('error', (error) => console.error('Failed to start inspector process:', error));
