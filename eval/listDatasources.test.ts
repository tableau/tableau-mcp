import {
  Agent,
  getAllMcpTools,
  MCPServerStdio,
  OpenAIChatCompletionsModel,
  run,
  withTrace,
} from '@openai/agents';
import dotenv from 'dotenv';
import ollama from 'ollama';
import { OpenAI } from 'openai/client.js';
import z from 'zod';

import invariant from '../src/utils/invariant.js';

const MODEL_TO_USE = 'qwen3:8b';

const EvaluationFeedback = z.object({
  feedback: z.string(),
  score: z.enum(['pass', 'needs_improvement', 'fail']),
});

describe('list-datasources', () => {
  let mcpServers: Array<MCPServerStdio>;
  let agent: Agent;

  beforeAll(
    async () => {
      dotenv.config({ path: 'eval/.env' });

      try {
        await fetch('http://localhost:11434/api/version');
      } catch {
        throw new Error('Ollama is not running. Install and start it before running these tests');
      }

      console.log('Ollama is running. Checking for models...');
      const models = (await ollama.list()).models.map((model) => model.name);
      console.log(`Found ${models.length} models:`);
      for (const model of models) {
        console.log(`  - ${model}`);
      }

      if (!models.includes(MODEL_TO_USE)) {
        if (process.env.OLLAMA_MODELS) {
          console.log(`Models will be stored in ${process.env.OLLAMA_MODELS}`);
        } else {
          console.log(
            'Models will be stored in the default location. You can change this by setting the OLLAMA_MODELS environment variable.',
          );
        }

        console.log(`Pulling ${MODEL_TO_USE}. Go get some ☕...`);

        let previousPercentage = 0;
        const progress = await ollama.pull({ model: MODEL_TO_USE, stream: true });
        process.stdout.write('0');
        for await (const part of progress) {
          const percentage = Math.floor((100 * part.completed) / part.total);
          if (percentage > previousPercentage) {
            previousPercentage = percentage;
            process.stdout.write(percentage % 10 === 0 ? percentage.toString() : '.');
          }
        }
        process.stdout.write('\n');
      }
    },
    10 * 60 * 1000,
  );

  beforeEach(async () => {
    mcpServers = [
      new MCPServerStdio({
        command: 'node',
        args: ['build/index.js'],
        env: {
          TRANSPORT: 'stdio',
          SERVER: 'https://10ax.online.tableau.com',
          SITE_NAME: 'mcp-test',
          PAT_NAME: 'mcp-test',
          PAT_VALUE: 'redacted',
        },
        cacheToolsList: true,
      }),
    ];

    for (const mcpServer of mcpServers) {
      await mcpServer.connect();
    }

    await withTrace('get_tools', async () => {
      const allTools = await getAllMcpTools(mcpServers);

      agent = new Agent({
        name: 'MCP Assistant with Pre-fetched Tools',
        instructions:
          'Always answer using the available tools to help the user with querying Tableau data sources. Never use other tools or answer with other information.',
        mcpServers,
        tools: allTools,
        modelSettings: { toolChoice: 'required' },
        model: new OpenAIChatCompletionsModel(
          new OpenAI({
            baseURL: 'http://localhost:11434/v1/',
            apiKey: 'ollama',
          }),
          MODEL_TO_USE,
        ),
      });
    });
  });

  afterEach(async () => {
    for (const mcpServer of mcpServers) {
      await mcpServer.close();
    }
  });

  it('should call search_content tool', { timeout: 10 * 60 * 1000 }, async () => {
    const message = 'List my Tableau data sources';
    console.log(`Running: ${message}.\n`);

    const result = await withTrace('run_agent', async () => {
      const stream = await run(agent, message, { stream: true });
      stream.toTextStream({ compatibleWithNodeStreams: true }).pipe(process.stdout);

      await stream.completed;
      return stream;
    });

    console.log('tools called:');
    for (const item of result.history) {
      if (item.type === 'function_call') {
        console.log(item.name);
        console.log(JSON.stringify({ name: item.name, arguments: item.arguments }, null, 2));
      }
    }

    console.log('tool call results:');
    for (const item of result.history) {
      if (item.type === 'function_call_result') {
        console.log(item.name);
        console.log(
          item.output.type === 'text'
            ? item.output.text
            : item.output.type === 'image'
              ? item.output.data
              : '',
        );
      }
    }
  });

  it.skip('should call get_datasource_metadata tool', { timeout: 10 * 60 * 1000 }, async () => {
    const message = 'Get the metadata for the Superstore Datasource.';
    console.log(`Running: ${message}.\n`);

    const result = await withTrace('run_agent', async () => {
      const stream = await run(agent, message, { stream: true });
      stream.toTextStream({ compatibleWithNodeStreams: true }).pipe(process.stdout);

      await stream.completed;
      return stream;
    });

    console.log('tools called:');
    for (const item of result.history) {
      if (item.type === 'function_call') {
        console.log(item.name);
        console.log(JSON.stringify({ name: item.name, arguments: item.arguments }, null, 2));
      }
    }

    console.log('tool call results:');
    for (const item of result.history) {
      if (item.type === 'function_call_result') {
        console.log(item.name);
        console.log(
          item.output.type === 'text'
            ? item.output.text
            : item.output.type === 'image'
              ? item.output.data
              : '',
        );
      }
    }

    // const evaluator = new Agent({
    //   name: 'evaluator',
    //   instructions:
    //     "You evaluate the output of the agent and decide if it's good enough. If it's not good enough, you provide feedback on what needs to be improved. Never give it a pass on the first try.",
    //   outputType: EvaluationFeedback,
    //   model: new OpenAIChatCompletionsModel(
    //     new OpenAI({
    //       baseURL: 'http://localhost:11434/v1/',
    //       apiKey: 'ollama',
    //     }),
    //     MODEL_TO_USE,
    //   ),
    // });

    // console.log('Evaluating agent...');
    // const evaluation = await withTrace('evaluate_agent', async () => {
    //   const stream = await run(evaluator, result.history, { stream: true });
    //   stream.toTextStream({ compatibleWithNodeStreams: true }).pipe(process.stdout);
    //   await stream.completed;
    //   return stream;
    // });

    // console.log('Evaluation complete.');
    // const feedback = evaluation.finalOutput;
    // invariant(feedback);
    // expect(feedback.score).toBe('pass');
    // expect(feedback.feedback).toBe('The output is good enough.');
  });
});
