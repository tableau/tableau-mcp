export type TypeOrProvider<T> = T | Provider<T>;

export class Provider<T> {
  private readonly _provider: () => T | Promise<T>;

  constructor(provider: () => T | Promise<T>) {
    this._provider = provider;
  }

  private get(): T | Promise<T> {
    return this._provider();
  }

  static async from(typeOrProvider: undefined): Promise<undefined>;
  static async from<T>(typeOrProvider: TypeOrProvider<T>): Promise<T>;
  static async from<T>(typeOrProvider: TypeOrProvider<T> | undefined): Promise<T | undefined> {
    if (typeOrProvider === undefined) {
      return undefined;
    }

    if (typeOrProvider instanceof Provider) {
      const provider = typeOrProvider;
      return await provider.get();
    }

    const type = typeOrProvider;
    return type;
  }
}
