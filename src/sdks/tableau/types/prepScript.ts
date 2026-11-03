export type PrepPhysicalType =
  | 'string'
  | 'integer'
  | 'real'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'spatial';
export type PrepScriptAnalysis = {
  language: 'python' | 'r';
  sourceSha256: string;
  fields: Record<string, PrepPhysicalType>;
  schemaStatus: 'static-declaration' | 'missing' | 'dynamic' | 'limited' | 'invalid-or-dynamic';
  functions: Record<
    string,
    {
      inputFields: string[];
      outputs: Record<string, { inputs: string[]; status: 'static' | 'candidate' }>;
      returnsInput: boolean;
      dependencyStatus: 'partial-static' | 'dynamic';
    }
  >;
  nativeExecutionVerified: false;
};
export type PrepScriptEvidence = Record<string, PrepScriptAnalysis>;
export type PrepScriptContext = {
  scripts: PrepScriptEvidence;
  packageSha256?: string;
  unavailable?: Record<string, 'limited' | 'invalid' | 'missing'>;
};

export type PrepExternalStep = {
  nodeId?: string;
  stepId: string;
  documentPath: string;
  family: 'script' | 'prediction';
  settings: {
    language?: 'python' | 'r' | 'unknown';
    function?: string;
    packagedScript?: boolean;
    externalScript?: boolean;
    predictionSettingsType?: string;
    outcomeName?: string;
    topPredictors?: number;
    topImprovements?: number;
    modelDefinitionPresent?: boolean;
    connectionPresent?: boolean;
  };
  fieldMappings?: Array<{ inputField: string; modelField?: string }>;
  inputFields: Array<{ name: string; type?: string; role: 'explicit-reference' | 'provided' }>;
  usedFields: string[];
  outputFields: Array<{ name: string; type?: string }>;
  schemaStatus: string;
  dependencyStatus: string;
  sourceSha256?: string;
  schemaDifferences?: Array<{ name: string; kind: 'missing' | 'extra' | 'type' }>;
  truncated?: boolean;
  nativeExecutionVerified: false;
};
