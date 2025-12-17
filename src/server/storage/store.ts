export abstract class Store<T> {
  abstract get(key: string): Promise<T | undefined>;
  abstract set(key: string, data: T, expirationTimeMs: number): Promise<this>;
  abstract delete(key: string): Promise<boolean>;
  abstract exists(key: string): Promise<boolean>;
  abstract connect(): Promise<void>;
  abstract healthCheck(): Promise<boolean>;
  abstract close(): Promise<void>;
}
