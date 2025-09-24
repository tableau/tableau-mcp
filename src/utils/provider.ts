export class Provider<T> {
  private readonly _provider: () => T;

  constructor(provider: () => T) {
    this._provider = provider;
  }

  get(): T {
    return this._provider();
  }
}
