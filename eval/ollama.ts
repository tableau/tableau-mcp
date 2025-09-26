import ollama, { AbortableAsyncIterator, ProgressResponse } from 'ollama';

export type Model = 'qwen3:4b' | 'qwen3:8b' | 'qwen3:30b' | 'llama3.1:8b';

export const OLLAMA_API_BASE_URL = 'http://localhost:11434/v1';
export const OLLAMA_FAKE_API_KEY = 'ollama';

export async function throwIfOllamaNotRunning(): Promise<void> {
  try {
    await fetch(`${OLLAMA_API_BASE_URL}/version`);
  } catch {
    throw new Error('Ollama is not running. Install and start it before running these tests');
  }
}

export async function pullOllamaModel(model: Model): Promise<void> {
  const models = (await ollama.list()).models.map((m) => m.name);
  if (models.includes(model)) {
    return;
  }

  if (process.env.OLLAMA_MODELS) {
    console.log(`Models will be stored in ${process.env.OLLAMA_MODELS}`);
  } else {
    console.log(
      'Models will be stored in the default location. You can change this by setting the OLLAMA_MODELS environment variable.',
    );
  }

  console.log(`Pulling ${model}. Go get some ☕...`);
  const progress = await ollama.pull({ model, stream: true });
  await writeProgressForStream(progress);
}

async function writeProgressForStream(
  iter: AbortableAsyncIterator<ProgressResponse>,
): Promise<void> {
  process.stdout.write('\n');

  let previousPercentage = 0;
  for await (const progress of iter) {
    const percentage = Math.floor((100 * progress.completed) / progress.total);
    if (percentage > previousPercentage) {
      process.stdout.write(
        previousPercentage === 0 || percentage % 10 === 0 ? percentage.toString() : '.',
      );
      previousPercentage = percentage;
    }
  }

  process.stdout.write('\n');
}
