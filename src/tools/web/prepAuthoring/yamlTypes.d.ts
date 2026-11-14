declare module 'js-yaml' {
  export class Type {
    constructor(
      tag: string,
      options: {
        kind: 'scalar' | 'mapping' | 'sequence';
        resolve?: (value: string | null, explicitTag?: string) => boolean;
        construct?: (value: unknown) => unknown;
        predicate?: (value: unknown) => boolean;
        represent?: (value: unknown) => string;
      },
    );
    options: { kind: 'scalar' | 'mapping' | 'sequence'; [key: string]: unknown };
    tag: string;
    resolve: (value: string | null) => boolean;
    construct: (value: unknown) => unknown;
  }
  export class Schema {
    constructor(options: { implicit: Type[]; explicit: Type[] });
    extend(types: Type[]): Schema;
  }
  export const CORE_SCHEMA: Schema;
  export const types: Record<'str' | 'map' | 'seq' | 'null' | 'bool' | 'int' | 'float', Type>;
  export function load(
    text: string,
    options?: {
      schema?: Schema;
      listener?: (
        event: string,
        state: { anchor: string | null; kind: string | null; result: unknown },
      ) => void;
    },
  ): unknown;
  export function dump(
    value: unknown,
    options?: {
      schema?: Schema;
      noRefs?: boolean;
      lineWidth?: number;
      sortKeys?: boolean;
      noCompatMode?: boolean;
    },
  ): string;
}
