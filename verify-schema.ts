// Simple verification script to test that dataSourceSchema works correctly
import { dataSourceSchema, DataSource } from './src/sdks/tableau/types/dataSource.js';

// Test the schema with description field
const testDataSource: DataSource = {
  id: 'test-id',
  name: 'Test Datasource',
  description: 'This is a test description',
  project: {
    name: 'Test Project',
    id: 'test-project-id'
  }
};

// Test the schema without description field (should still work because it's optional)
const testDataSourceWithoutDescription: DataSource = {
  id: 'test-id-2',
  name: 'Test Datasource 2',
  project: {
    name: 'Test Project 2',
    id: 'test-project-id-2'
  }
};

// Validate using Zod schema
const validationResult1 = dataSourceSchema.safeParse(testDataSource);
const validationResult2 = dataSourceSchema.safeParse(testDataSourceWithoutDescription);

console.log('Validation with description:', validationResult1.success);
console.log('Validation without description:', validationResult2.success);

if (validationResult1.success) {
  console.log('Data with description:', validationResult1.data);
}

if (validationResult2.success) {
  console.log('Data without description:', validationResult2.data);
}
