import { createClient, RedisClientType } from 'redis';

export default class RedisStore<T> {
  private client: RedisClientType;
  private keyPrefix: string;

  constructor({ keyPrefix }: { keyPrefix: string }) {
    this.keyPrefix = keyPrefix;

    this.client = createClient({
      url: 'redis://localhost:6379/1',
    });
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  async get(key: string): Promise<T | undefined> {
    const fullKey = this.getFullKey(key);
    const data = await this.client.get(fullKey);
    return data ? JSON.parse(data) : undefined;
  }

  async set(key: string, data: T, expirationTimeMs: number): Promise<this> {
    const fullKey = this.getFullKey(key);
    const value = JSON.stringify(data);

    if (expirationTimeMs) {
      await this.client.setEx(fullKey, Math.floor(expirationTimeMs / 1000), value);
    } else {
      await this.client.set(fullKey, value);
    }

    return this;
  }

  async delete(key: string): Promise<boolean> {
    return (await this.client.del(this.getFullKey(key))) === 1;
  }

  async exists(key: string): Promise<boolean> {
    return (await this.client.exists(this.getFullKey(key))) === 1;
  }

  async healthCheck(): Promise<boolean> {
    const result = await this.client.ping();
    return result === 'PONG';
  }

  async close(): Promise<void> {
    await this.client.quit();
  }

  private getFullKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }
}
