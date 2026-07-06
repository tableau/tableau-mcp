import { FlowDocument } from '../../../../sdks/tableau/types/flowDocument.js';

/**
 * A representative sanitized flow document: two inputs (a packaged CSV and a
 * SQL Server table) join → filter → calculated column → publish-as-extract
 * output. Exercises every classification branch the summarizer cares about
 * (input/output/transform), connection resolution (file + database), lineage
 * edges, per-node field schemas, and a document-level parameter.
 */
export const mockFlowDocument = {
  documentId: 'doc-aaaa-bbbb',
  majorVersion: 2024,
  minorVersion: 3,
  initialNodes: ['n-input-csv', 'n-input-sql'],
  connections: {
    'c-csv': {
      id: 'c-csv',
      connectionType: '.v1.FileConnection',
      name: 'Orders.csv',
      isPackaged: true,
      connectionAttributes: { class: 'textscan', filename: 'Orders.csv' },
    },
    'c-sql': {
      id: 'c-sql',
      connectionType: '.v1.SqlConnection',
      name: 'Sales DB',
      isPackaged: false,
      connectionAttributes: {
        class: 'sqlserver',
        server: 'sql.internal.example.com',
        dbname: 'SalesDW',
        schema: 'dbo',
      },
    },
  },
  dataConnections: {},
  parameters: {
    parameters: {
      p1: { name: 'Region', type: 'string', value: 'West' },
    },
  },
  nodes: {
    'n-input-csv': {
      id: 'n-input-csv',
      name: 'Orders.csv',
      nodeType: '.v1.LoadCsv',
      baseType: 'input',
      connectionId: 'c-csv',
      nextNodes: [{ nextNodeId: 'n-join' }],
      fields: [
        { name: 'OrderId', type: 'integer' },
        { name: 'Amount', type: 'real' },
      ],
    },
    'n-input-sql': {
      id: 'n-input-sql',
      name: 'Customers',
      nodeType: '.v1.LoadSql',
      baseType: 'input',
      connectionId: 'c-sql',
      nextNodes: [{ nextNodeId: 'n-join' }],
    },
    'n-join': {
      id: 'n-join',
      name: 'Join Orders + Customers',
      nodeType: '.v1.Join',
      baseType: 'transform',
      nextNodes: [{ nextNodeId: 'n-filter' }],
    },
    'n-filter': {
      id: 'n-filter',
      name: 'Keep 2024',
      nodeType: '.v1.Filter',
      baseType: 'transform',
      nextNodes: [{ nextNodeId: 'n-calc' }],
    },
    'n-calc': {
      id: 'n-calc',
      name: 'Profit Ratio',
      nodeType: '.v1.AddColumn',
      baseType: 'transform',
      nextNodes: [{ nextNodeId: 'n-output' }],
    },
    'n-output': {
      id: 'n-output',
      name: 'Sales Mart',
      nodeType: '.v1.PublishExtract',
      baseType: 'output',
      datasourceName: 'Sales Mart',
      projectName: 'Finance',
      nextNodes: [],
    },
  },
} satisfies FlowDocument;
