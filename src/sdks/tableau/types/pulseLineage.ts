export type PulseLineageRequest =
  | { kind: 'definitions'; id?: string; after?: string; pageSize?: number }
  | { kind: 'metrics'; definitionId: string; after?: string; pageSize?: number }
  | { kind: 'metric'; id: string };

export type PulseFieldUse = {
  path: string;
  datasourceLuid?: string;
  selector: string;
  role: 'pulse-measure' | 'pulse-time' | 'pulse-filter' | 'pulse-field' | 'pulse-allowed-dimension';
  evidence: 'direct' | 'possible';
  aggregation?: string;
  operator?: string;
  values: Array<string | number | boolean | null>;
};

export type PulseLineageOwner = {
  kind: 'pulse-definition' | 'pulse-metric';
  luid: string;
  name?: string;
  datasourceLuid?: string;
  definitionLuid?: string;
  path: string;
  uses: PulseFieldUse[];
  opaque: boolean;
};

export type PulseLineagePage = {
  owners: PulseLineageOwner[];
  nextPageToken?: string;
  totalAvailable?: number;
  rowCount: number;
  limited: boolean;
};
