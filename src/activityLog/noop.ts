import type { ActivityLogProvider } from './provider.js';

export class NoOpActivityLogProvider implements ActivityLogProvider {
  recordToolCall(): void {}
}
