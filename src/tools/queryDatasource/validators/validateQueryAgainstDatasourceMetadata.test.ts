import { describe, expect, it } from 'vitest';

import {
  Field,
  MetadataResponse,
  QueryParameter,
} from '../../../sdks/tableau/apis/vizqlDataServiceApi.js';
import {
  QueryValidationError,
  validateFieldsAgainstDatasourceMetadata,
  validateParametersAgainstDatasourceMetadata,
} from './validateQueryAgainstDatasourceMetadata.js';

// Sample metadata response based on user-provided example
const sampleMetadataResponse: MetadataResponse = {
  data: [
    {
      fieldName: 'Calculation_1212826468716551',
      fieldCaption: 'Calculation Datetime',
      dataType: 'DATETIME',
      defaultAggregation: 'YEAR',
      columnClass: 'CALCULATION',
      formula: '[Parameters].[Parameter 8]',
    },
    {
      fieldName: 'Category',
      fieldCaption: 'Category',
      dataType: 'STRING',
      defaultAggregation: 'COUNT',
      logicalTableId: 'Orders_ECFCA1FB690A41FE803BC071773BA862',
      columnClass: 'COLUMN',
    },
    {
      fieldName: 'Discount',
      fieldCaption: 'Discount',
      dataType: 'REAL',
      defaultAggregation: 'SUM',
      logicalTableId: 'Orders_ECFCA1FB690A41FE803BC071773BA862',
      columnClass: 'COLUMN',
    },
    {
      fieldName: 'Calculation_1212826467659778',
      fieldCaption: 'Calculation Int',
      dataType: 'INTEGER',
      defaultAggregation: 'SUM',
      columnClass: 'CALCULATION',
      formula: '[Test Int]',
    },
    {
      fieldName: 'Regional Manager',
      fieldCaption: 'Regional Manager',
      dataType: 'STRING',
      defaultAggregation: 'COUNT',
      logicalTableId: 'People_D73023733B004CC1B3CB1ACF62F4A965',
      columnClass: 'COLUMN',
    },
    {
      fieldName: 'Ship Date',
      fieldCaption: 'Ship Date',
      dataType: 'DATE',
      defaultAggregation: 'YEAR',
      logicalTableId: 'Orders_ECFCA1FB690A41FE803BC071773BA862',
      columnClass: 'COLUMN',
    },
    {
      fieldName: 'Sub-Category',
      fieldCaption: 'Sub-Category',
      dataType: 'STRING',
      defaultAggregation: 'COUNT',
      logicalTableId: 'Orders_ECFCA1FB690A41FE803BC071773BA862',
      columnClass: 'COLUMN',
    },
    {
      fieldName: 'Profit (bin)',
      fieldCaption: 'Profit (bin)',
      dataType: 'INTEGER',
      defaultAggregation: 'NONE',
      logicalTableId: 'Orders_ECFCA1FB690A41FE803BC071773BA862',
      columnClass: 'BIN',
      formula: 'SYS_NUMBIN([Profit],[Profit Bin Size])',
    },
    {
      fieldName: 'Segment',
      fieldCaption: 'Segment',
      dataType: 'STRING',
      defaultAggregation: 'COUNT',
      logicalTableId: 'Orders_ECFCA1FB690A41FE803BC071773BA862',
      columnClass: 'COLUMN',
    },
    {
      fieldName: 'Sales',
      fieldCaption: 'Sales',
      dataType: 'REAL',
      defaultAggregation: 'SUM',
      logicalTableId: 'Orders_ECFCA1FB690A41FE803BC071773BA862',
      columnClass: 'COLUMN',
    },
    {
      fieldName: 'Product Name (group)',
      fieldCaption: 'Manufacturer',
      dataType: 'STRING',
      defaultAggregation: 'COUNT',
      logicalTableId: 'Orders_ECFCA1FB690A41FE803BC071773BA862',
      columnClass: 'GROUP',
    },
    {
      fieldName: 'Calculation_1212826464169984',
      fieldCaption: 'Calculation Float',
      dataType: 'REAL',
      defaultAggregation: 'SUM',
      columnClass: 'CALCULATION',
      formula: '[Test Float]',
    },
    {
      fieldName: 'Ship Mode',
      fieldCaption: 'Ship Mode',
      dataType: 'STRING',
      defaultAggregation: 'COUNT',
      logicalTableId: 'Orders_ECFCA1FB690A41FE803BC071773BA862',
      columnClass: 'COLUMN',
    },
    {
      fieldName: 'Calculation_1212826468106244',
      fieldCaption: 'Calculation String',
      dataType: 'STRING',
      defaultAggregation: 'COUNT',
      columnClass: 'CALCULATION',
      formula: '[Test String]',
    },
    {
      fieldName: 'Order Date',
      fieldCaption: 'Order Date',
      dataType: 'DATE',
      defaultAggregation: 'YEAR',
      logicalTableId: 'Orders_ECFCA1FB690A41FE803BC071773BA862',
      columnClass: 'COLUMN',
    },
    {
      fieldName: 'Profit',
      fieldCaption: 'Profit',
      dataType: 'REAL',
      defaultAggregation: 'SUM',
      logicalTableId: 'Orders_ECFCA1FB690A41FE803BC071773BA862',
      columnClass: 'COLUMN',
    },
    {
      fieldName: 'Calculation_1212826468020227',
      fieldCaption: 'Calculation Spatial',
      dataType: 'SPATIAL',
      defaultAggregation: 'COLLECT',
      columnClass: 'CALCULATION',
      formula: '[Parameters].[Parameter 9]',
    },
    {
      fieldName: 'Calculation_1368249927221915648',
      fieldCaption: 'Profit Ratio',
      dataType: 'REAL',
      defaultAggregation: 'AGG',
      columnClass: 'CALCULATION',
      formula: 'SUM([Profit])/SUM([Sales])',
    },
    {
      fieldName: 'Customer Name',
      fieldCaption: 'Customer Name',
      dataType: 'STRING',
      defaultAggregation: 'COUNT',
      logicalTableId: 'Orders_ECFCA1FB690A41FE803BC071773BA862',
      columnClass: 'COLUMN',
    },
    {
      fieldName: 'Returned',
      fieldCaption: 'Returned',
      dataType: 'STRING',
      defaultAggregation: 'COUNT',
      logicalTableId: 'Returns_2AA0FE4D737A4F63970131D0E7480A03',
      columnClass: 'COLUMN',
    },
    {
      fieldName: 'Postal Code',
      fieldCaption: 'Postal Code',
      dataType: 'STRING',
      defaultAggregation: 'COUNT',
      logicalTableId: 'Orders_ECFCA1FB690A41FE803BC071773BA862',
      columnClass: 'COLUMN',
    },
    {
      fieldName: 'Calculation_1212826468200453',
      fieldCaption: 'Calculation Boolean',
      dataType: 'BOOLEAN',
      defaultAggregation: 'COUNT',
      columnClass: 'CALCULATION',
      formula: '[Test Boolean]',
    },
    {
      fieldName: 'Order ID',
      fieldCaption: 'Order ID',
      dataType: 'STRING',
      defaultAggregation: 'COUNT',
      logicalTableId: 'Orders_ECFCA1FB690A41FE803BC071773BA862',
      columnClass: 'COLUMN',
    },
    {
      fieldName: 'Product Name',
      fieldCaption: 'Product Name',
      dataType: 'STRING',
      defaultAggregation: 'COUNT',
      logicalTableId: 'Orders_ECFCA1FB690A41FE803BC071773BA862',
      columnClass: 'COLUMN',
    },
    {
      fieldName: 'Quantity',
      fieldCaption: 'Quantity',
      dataType: 'INTEGER',
      defaultAggregation: 'SUM',
      logicalTableId: 'Orders_ECFCA1FB690A41FE803BC071773BA862',
      columnClass: 'COLUMN',
    },
    {
      fieldName: 'City',
      fieldCaption: 'City',
      dataType: 'STRING',
      defaultAggregation: 'COUNT',
      logicalTableId: 'Orders_ECFCA1FB690A41FE803BC071773BA862',
      columnClass: 'COLUMN',
    },
    {
      fieldName: 'State/Province',
      fieldCaption: 'State/Province',
      dataType: 'STRING',
      defaultAggregation: 'COUNT',
      logicalTableId: 'Orders_ECFCA1FB690A41FE803BC071773BA862',
      columnClass: 'COLUMN',
    },
    {
      fieldName: 'Calculation_1212826468347910',
      fieldCaption: 'Calculation Date',
      dataType: 'DATE',
      defaultAggregation: 'YEAR',
      columnClass: 'CALCULATION',
      formula: '[Test Date]',
    },
    {
      fieldName: 'Region',
      fieldCaption: 'Region',
      dataType: 'STRING',
      defaultAggregation: 'COUNT',
      logicalTableId: 'Orders_ECFCA1FB690A41FE803BC071773BA862',
      columnClass: 'COLUMN',
    },
    {
      fieldName: 'Country/Region',
      fieldCaption: 'Country/Region',
      dataType: 'STRING',
      defaultAggregation: 'COUNT',
      logicalTableId: 'Orders_ECFCA1FB690A41FE803BC071773BA862',
      columnClass: 'COLUMN',
    },
  ],
  extraData: {
    parameters: [
      {
        parameterType: 'QUANTITATIVE_DATE',
        parameterName: 'Parameter 7',
        parameterCaption: 'Test Date',
        dataType: 'DATE',
        value: '2025-10-17',
        minDate: '2024-01-01',
        maxDate: '2026-01-01',
      },
      {
        parameterType: 'ANY_VALUE',
        parameterName: 'Parameter 5',
        parameterCaption: 'Test String',
        dataType: 'STRING',
        value: 'Hello World!',
      },
      {
        parameterType: 'LIST',
        parameterName: 'Parameter 6',
        parameterCaption: 'Test Boolean',
        dataType: 'BOOLEAN',
        value: false,
        members: [{ value: true }, { value: false }],
      },
      {
        parameterType: 'QUANTITATIVE_RANGE',
        parameterName: 'Parameter 3',
        parameterCaption: 'Test Float',
        dataType: 'REAL',
        value: 2.5,
        min: 1.5,
        max: null,
        step: 1,
      },
      {
        parameterType: 'LIST',
        parameterName: 'Parameter 4',
        parameterCaption: 'Test Int',
        dataType: 'INTEGER',
        value: 1,
        members: [{ value: 1 }, { value: 2 }, { value: 3 }],
      },
      {
        parameterType: 'QUANTITATIVE_RANGE',
        parameterName: 'Parameter 1',
        parameterCaption: 'Top Customers',
        dataType: 'INTEGER',
        value: 5,
        min: 5,
        max: 20,
        step: 5,
      },
      {
        parameterType: 'QUANTITATIVE_RANGE',
        parameterName: 'Parameter 2',
        parameterCaption: 'Profit Bin Size',
        dataType: 'INTEGER',
        value: 200,
        min: 50,
        max: 200,
        step: 50,
      },
    ],
  },
};

describe('validateFieldsAgainstDatasourceMetadata', () => {
  describe('valid field queries', () => {
    it('should not add errors for valid dimension fields', () => {
      const fields: Field[] = [{ fieldCaption: 'Category' }, { fieldCaption: 'Region' }];
      const validationErrors: QueryValidationError[] = [];

      validateFieldsAgainstDatasourceMetadata(fields, sampleMetadataResponse, validationErrors);

      expect(validationErrors).toHaveLength(0);
    });

    it('should not add errors for valid measure fields with correct functions', () => {
      const fields: Field[] = [
        { fieldCaption: 'Sales', function: 'SUM' },
        { fieldCaption: 'Profit', function: 'AVG' },
        { fieldCaption: 'Quantity', function: 'COUNT' },
      ];
      const validationErrors: QueryValidationError[] = [];

      validateFieldsAgainstDatasourceMetadata(fields, sampleMetadataResponse, validationErrors);

      expect(validationErrors).toHaveLength(0);
    });

    it('should not add errors for custom calculations with new field captions', () => {
      const fields: Field[] = [
        { fieldCaption: 'My Custom Calculation', calculation: 'SUM([Sales]) / SUM([Profit])' },
      ];
      const validationErrors: QueryValidationError[] = [];

      validateFieldsAgainstDatasourceMetadata(fields, sampleMetadataResponse, validationErrors);

      expect(validationErrors).toHaveLength(0);
    });

    it('should not add errors for bin fields with corresponding measure field', () => {
      const fields: Field[] = [
        { fieldCaption: 'Sales', function: 'SUM' },
        { fieldCaption: 'Sales', binSize: 100 },
      ];
      const validationErrors: QueryValidationError[] = [];

      validateFieldsAgainstDatasourceMetadata(fields, sampleMetadataResponse, validationErrors);

      expect(validationErrors).toHaveLength(0);
    });
  });

  describe('bin field validation', () => {
    it('should add error when trying to modify preexisting bin field', () => {
      const fields: Field[] = [{ fieldCaption: 'Profit (bin)', binSize: 100 }];
      const validationErrors: QueryValidationError[] = [];

      validateFieldsAgainstDatasourceMetadata(fields, sampleMetadataResponse, validationErrors);

      expect(validationErrors).toHaveLength(1);
      expect(validationErrors[0]).toEqual({
        field: 'Profit (bin)',
        message:
          "The bin field 'Profit (bin)' has a fixed bin size defined in the datasource and can not be modified. To create a new bin on a field, use the field caption of the measure field you want to group. To use this bin, omit the binSize property.",
      });
    });

    it('should add error when bin field has no corresponding measure field', () => {
      const fields: Field[] = [{ fieldCaption: 'Sales', binSize: 100 }];
      const validationErrors: QueryValidationError[] = [];

      validateFieldsAgainstDatasourceMetadata(fields, sampleMetadataResponse, validationErrors);

      expect(validationErrors).toHaveLength(1);
      expect(validationErrors[0]).toEqual({
        field: 'Sales',
        message:
          "The bin field 'Sales' was provided in the query, but no corresponding measure field was found. To create a new bin on a field, use the field caption of the measure field you want to group.",
      });
    });
  });

  describe('calculation field validation', () => {
    it('should add error when field is not found in datasource and is not a calculation', () => {
      const fields: Field[] = [{ fieldCaption: 'Nonexistent Field' }];
      const validationErrors: QueryValidationError[] = [];

      validateFieldsAgainstDatasourceMetadata(fields, sampleMetadataResponse, validationErrors);

      expect(validationErrors).toHaveLength(1);
      expect(validationErrors[0]).toEqual({
        field: 'Nonexistent Field',
        message:
          "Field 'Nonexistent Field' was not found in the datasource. Fields must either belong to the datasource or provide a custom calculation.",
      });
    });

    it('should add error when providing calculation for existing field with formula', () => {
      const fields: Field[] = [{ fieldCaption: 'Profit Ratio', calculation: 'AVG([Profit])' }];
      const validationErrors: QueryValidationError[] = [];

      validateFieldsAgainstDatasourceMetadata(fields, sampleMetadataResponse, validationErrors);

      expect(validationErrors).toHaveLength(1);
      expect(validationErrors[0]).toEqual({
        field: 'Profit Ratio',
        message:
          "A custom calculation was provided for field 'Profit Ratio', but this field already has a calculation and can not be overwritten. To query this field, omit the calculation property. To create a new calculation, provide a new field caption.",
      });
    });

    it('should add error when providing calculation for existing non-calculated field', () => {
      const fields: Field[] = [{ fieldCaption: 'Sales', calculation: 'SUM([Sales]) * 2' }];
      const validationErrors: QueryValidationError[] = [];

      validateFieldsAgainstDatasourceMetadata(fields, sampleMetadataResponse, validationErrors);

      expect(validationErrors).toHaveLength(1);
      expect(validationErrors[0]).toEqual({
        field: 'Sales',
        message:
          "A custom calculation was provided for field 'Sales', but this field already exists in the datasource. To create a new calculation, provide a new field caption. To query this field, omit the calculation property.",
      });
    });
  });

  describe('INTEGER and REAL field function validation', () => {
    const validNumericFunctions = [
      'SUM',
      'AVG',
      'MEDIAN',
      'COUNT',
      'COUNTD',
      'MIN',
      'MAX',
      'STDEV',
      'VAR',
    ] as const;

    it.each(validNumericFunctions)('should allow %s function for REAL fields', (func) => {
      const fields: Field[] = [{ fieldCaption: 'Sales', function: func }];
      const validationErrors: QueryValidationError[] = [];

      validateFieldsAgainstDatasourceMetadata(fields, sampleMetadataResponse, validationErrors);

      expect(validationErrors).toHaveLength(0);
    });

    it.each(validNumericFunctions)('should allow %s function for INTEGER fields', (func) => {
      const fields: Field[] = [{ fieldCaption: 'Quantity', function: func }];
      const validationErrors: QueryValidationError[] = [];

      validateFieldsAgainstDatasourceMetadata(fields, sampleMetadataResponse, validationErrors);

      expect(validationErrors).toHaveLength(0);
    });

    it('should add error for invalid function on REAL field', () => {
      const fields: Field[] = [{ fieldCaption: 'Sales', function: 'YEAR' }];
      const validationErrors: QueryValidationError[] = [];

      validateFieldsAgainstDatasourceMetadata(fields, sampleMetadataResponse, validationErrors);

      expect(validationErrors).toHaveLength(1);
      expect(validationErrors[0]).toEqual({
        field: 'Sales',
        message:
          "The 'Sales' field is of type 'REAL'. The 'YEAR' function can not be applied to fields of this data type.",
      });
    });

    it('should add error for invalid function on INTEGER field', () => {
      const fields: Field[] = [{ fieldCaption: 'Quantity', function: 'TRUNC_MONTH' }];
      const validationErrors: QueryValidationError[] = [];

      validateFieldsAgainstDatasourceMetadata(fields, sampleMetadataResponse, validationErrors);

      expect(validationErrors).toHaveLength(1);
      expect(validationErrors[0]).toEqual({
        field: 'Quantity',
        message:
          "The 'Quantity' field is of type 'INTEGER'. The 'TRUNC_MONTH' function can not be applied to fields of this data type.",
      });
    });
  });

  describe('STRING and BOOLEAN field function validation', () => {
    const validStringFunctions = ['MIN', 'MAX', 'COUNT', 'COUNTD'] as const;

    it.each(validStringFunctions)('should allow %s function for STRING fields', (func) => {
      const fields: Field[] = [{ fieldCaption: 'Category', function: func }];
      const validationErrors: QueryValidationError[] = [];

      validateFieldsAgainstDatasourceMetadata(fields, sampleMetadataResponse, validationErrors);

      expect(validationErrors).toHaveLength(0);
    });

    it.each(validStringFunctions)('should allow %s function for BOOLEAN fields', (func) => {
      const fields: Field[] = [{ fieldCaption: 'Calculation Boolean', function: func }];
      const validationErrors: QueryValidationError[] = [];

      validateFieldsAgainstDatasourceMetadata(fields, sampleMetadataResponse, validationErrors);

      expect(validationErrors).toHaveLength(0);
    });

    it('should add error for SUM on STRING field', () => {
      const fields: Field[] = [{ fieldCaption: 'Category', function: 'SUM' }];
      const validationErrors: QueryValidationError[] = [];

      validateFieldsAgainstDatasourceMetadata(fields, sampleMetadataResponse, validationErrors);

      expect(validationErrors).toHaveLength(1);
      expect(validationErrors[0]).toEqual({
        field: 'Category',
        message:
          "The 'Category' field is of type 'STRING'. The 'SUM' function can not be applied to fields of this data type.",
      });
    });

    it('should add error for AVG on BOOLEAN field', () => {
      const fields: Field[] = [{ fieldCaption: 'Calculation Boolean', function: 'AVG' }];
      const validationErrors: QueryValidationError[] = [];

      validateFieldsAgainstDatasourceMetadata(fields, sampleMetadataResponse, validationErrors);

      expect(validationErrors).toHaveLength(1);
      expect(validationErrors[0]).toEqual({
        field: 'Calculation Boolean',
        message:
          "The 'Calculation Boolean' field is of type 'BOOLEAN'. The 'AVG' function can not be applied to fields of this data type.",
      });
    });
  });

  describe('DATE and DATETIME field function validation', () => {
    const validDateFunctions = [
      'MIN',
      'MAX',
      'COUNT',
      'COUNTD',
      'YEAR',
      'QUARTER',
      'MONTH',
      'WEEK',
      'DAY',
      'TRUNC_YEAR',
      'TRUNC_QUARTER',
      'TRUNC_MONTH',
      'TRUNC_WEEK',
      'TRUNC_DAY',
    ] as const;

    it.each(validDateFunctions)('should allow %s function for DATE fields', (func) => {
      const fields: Field[] = [{ fieldCaption: 'Order Date', function: func }];
      const validationErrors: QueryValidationError[] = [];

      validateFieldsAgainstDatasourceMetadata(fields, sampleMetadataResponse, validationErrors);

      expect(validationErrors).toHaveLength(0);
    });

    it.each(validDateFunctions)('should allow %s function for DATETIME fields', (func) => {
      const fields: Field[] = [{ fieldCaption: 'Calculation Datetime', function: func }];
      const validationErrors: QueryValidationError[] = [];

      validateFieldsAgainstDatasourceMetadata(fields, sampleMetadataResponse, validationErrors);

      expect(validationErrors).toHaveLength(0);
    });

    it('should add error for SUM on DATE field', () => {
      const fields: Field[] = [{ fieldCaption: 'Order Date', function: 'SUM' }];
      const validationErrors: QueryValidationError[] = [];

      validateFieldsAgainstDatasourceMetadata(fields, sampleMetadataResponse, validationErrors);

      expect(validationErrors).toHaveLength(1);
      expect(validationErrors[0]).toEqual({
        field: 'Order Date',
        message:
          "The 'Order Date' field is of type 'DATE'. The 'SUM' function can not be applied to fields of this data type.",
      });
    });

    it('should add error for AVG on DATETIME field', () => {
      const fields: Field[] = [{ fieldCaption: 'Calculation Datetime', function: 'AVG' }];
      const validationErrors: QueryValidationError[] = [];

      validateFieldsAgainstDatasourceMetadata(fields, sampleMetadataResponse, validationErrors);

      expect(validationErrors).toHaveLength(1);
      expect(validationErrors[0]).toEqual({
        field: 'Calculation Datetime',
        message:
          "The 'Calculation Datetime' field is of type 'DATETIME'. The 'AVG' function can not be applied to fields of this data type.",
      });
    });
  });

  describe('multiple field validation errors', () => {
    it('should accumulate multiple validation errors', () => {
      const fields: Field[] = [
        { fieldCaption: 'Nonexistent Field' },
        { fieldCaption: 'Sales', function: 'YEAR' },
        { fieldCaption: 'Category', function: 'SUM' },
      ];
      const validationErrors: QueryValidationError[] = [];

      validateFieldsAgainstDatasourceMetadata(fields, sampleMetadataResponse, validationErrors);

      expect(validationErrors).toHaveLength(3);
    });
  });

  describe('edge cases', () => {
    it('should handle empty metadata data array', () => {
      const fields: Field[] = [{ fieldCaption: 'Sales' }];
      const validationErrors: QueryValidationError[] = [];
      const emptyMetadata: MetadataResponse = { data: [] };

      validateFieldsAgainstDatasourceMetadata(fields, emptyMetadata, validationErrors);

      expect(validationErrors).toHaveLength(1);
      expect(validationErrors[0]).toMatchObject({
        field: 'Sales',
      });
    });

    it('should handle undefined metadata data', () => {
      const fields: Field[] = [{ fieldCaption: 'Sales' }];
      const validationErrors: QueryValidationError[] = [];
      const undefinedMetadata: MetadataResponse = {};

      validateFieldsAgainstDatasourceMetadata(fields, undefinedMetadata, validationErrors);

      expect(validationErrors).toHaveLength(1);
    });
  });
});

describe('validateParametersAgainstDatasourceMetadata', () => {
  describe('valid parameter queries', () => {
    it('should not add errors for valid parameters', () => {
      const parameters: QueryParameter[] = [
        { parameterCaption: 'Test String', value: 'Hello' },
        { parameterCaption: 'Test Int', value: 2 },
      ];
      const validationErrors: QueryValidationError[] = [];

      validateParametersAgainstDatasourceMetadata(
        parameters,
        sampleMetadataResponse,
        validationErrors,
      );

      expect(validationErrors).toHaveLength(0);
    });
  });

  describe('parameter not found validation', () => {
    it('should add error when parameter is not found in datasource', () => {
      const parameters: QueryParameter[] = [
        { parameterCaption: 'Nonexistent Parameter', value: 'test' },
      ];
      const validationErrors: QueryValidationError[] = [];

      validateParametersAgainstDatasourceMetadata(
        parameters,
        sampleMetadataResponse,
        validationErrors,
      );

      expect(validationErrors).toHaveLength(1);
      expect(validationErrors[0]).toEqual({
        parameter: 'Nonexistent Parameter',
        message:
          "Parameter 'Nonexistent Parameter' was not found in the datasource. Only parameters that are defined in the datasource can be used in a query.",
      });
    });
  });

  describe('ANY_VALUE parameter type validation', () => {
    it('should allow valid string value for STRING type', () => {
      const parameters: QueryParameter[] = [
        { parameterCaption: 'Test String', value: 'Valid String' },
      ];
      const validationErrors: QueryValidationError[] = [];

      validateParametersAgainstDatasourceMetadata(
        parameters,
        sampleMetadataResponse,
        validationErrors,
      );

      expect(validationErrors).toHaveLength(0);
    });

    it('should add error for non-string value on STRING type', () => {
      const parameters: QueryParameter[] = [{ parameterCaption: 'Test String', value: 123 }];
      const validationErrors: QueryValidationError[] = [];

      validateParametersAgainstDatasourceMetadata(
        parameters,
        sampleMetadataResponse,
        validationErrors,
      );

      expect(validationErrors).toHaveLength(1);
      expect(validationErrors[0]).toEqual({
        parameter: 'Test String',
        message:
          "Parameter 'Test String' has 'STRING' data type but was provided a value that does not match the data type: 123.",
      });
    });

    it('should allow null value for ANY_VALUE parameter', () => {
      const parameters: QueryParameter[] = [{ parameterCaption: 'Test String', value: null }];
      const validationErrors: QueryValidationError[] = [];

      validateParametersAgainstDatasourceMetadata(
        parameters,
        sampleMetadataResponse,
        validationErrors,
      );

      expect(validationErrors).toHaveLength(0);
    });
  });

  describe('LIST parameter type validation', () => {
    it('should allow value that is in members list', () => {
      const parameters: QueryParameter[] = [{ parameterCaption: 'Test Int', value: 2 }];
      const validationErrors: QueryValidationError[] = [];

      validateParametersAgainstDatasourceMetadata(
        parameters,
        sampleMetadataResponse,
        validationErrors,
      );

      expect(validationErrors).toHaveLength(0);
    });

    it('should allow boolean value that is in members list', () => {
      const parameters: QueryParameter[] = [{ parameterCaption: 'Test Boolean', value: true }];
      const validationErrors: QueryValidationError[] = [];

      validateParametersAgainstDatasourceMetadata(
        parameters,
        sampleMetadataResponse,
        validationErrors,
      );

      expect(validationErrors).toHaveLength(0);
    });

    it('should add error for value not in members list', () => {
      const parameters: QueryParameter[] = [{ parameterCaption: 'Test Int', value: 5 }];
      const validationErrors: QueryValidationError[] = [];

      validateParametersAgainstDatasourceMetadata(
        parameters,
        sampleMetadataResponse,
        validationErrors,
      );

      expect(validationErrors).toHaveLength(1);
      expect(validationErrors[0]).toEqual({
        parameter: 'Test Int',
        message:
          "Parameter 'Test Int' has a value that is not in the list of allowed values for the parameter. The list of allowed values is [1, 2, 3].",
      });
    });
  });

  describe('QUANTITATIVE_DATE parameter type validation', () => {
    it('should allow valid date within range', () => {
      const parameters: QueryParameter[] = [{ parameterCaption: 'Test Date', value: '2025-06-15' }];
      const validationErrors: QueryValidationError[] = [];

      validateParametersAgainstDatasourceMetadata(
        parameters,
        sampleMetadataResponse,
        validationErrors,
      );

      expect(validationErrors).toHaveLength(0);
    });

    it('should add error for invalid date format', () => {
      const parameters: QueryParameter[] = [{ parameterCaption: 'Test Date', value: 'not-a-date' }];
      const validationErrors: QueryValidationError[] = [];

      validateParametersAgainstDatasourceMetadata(
        parameters,
        sampleMetadataResponse,
        validationErrors,
      );

      expect(validationErrors).toHaveLength(1);
      expect(validationErrors[0]).toEqual({
        parameter: 'Test Date',
        message:
          "Parameter 'Test Date' was provided a value that is not a valid date. Dates must use the RFC 3339 standard. Example: 2025-03-14",
      });
    });

    it('should add error for non-string value on date parameter', () => {
      const parameters: QueryParameter[] = [{ parameterCaption: 'Test Date', value: 12345 }];
      const validationErrors: QueryValidationError[] = [];

      validateParametersAgainstDatasourceMetadata(
        parameters,
        sampleMetadataResponse,
        validationErrors,
      );

      expect(validationErrors).toHaveLength(1);
      expect(validationErrors[0]).toEqual({
        parameter: 'Test Date',
        message:
          "Parameter 'Test Date' was provided a value that is not a valid date. Dates must use the RFC 3339 standard. Example: 2025-03-14",
      });
    });

    it('should add error for date below minimum', () => {
      const parameters: QueryParameter[] = [{ parameterCaption: 'Test Date', value: '2023-01-01' }];
      const validationErrors: QueryValidationError[] = [];

      validateParametersAgainstDatasourceMetadata(
        parameters,
        sampleMetadataResponse,
        validationErrors,
      );

      expect(validationErrors).toHaveLength(1);
      expect(validationErrors[0]).toEqual({
        parameter: 'Test Date',
        message:
          "Parameter 'Test Date' was provided a value that is less than the minimum allowed date of 2024-01-01.",
      });
    });

    it('should add error for date above maximum', () => {
      const parameters: QueryParameter[] = [{ parameterCaption: 'Test Date', value: '2027-01-01' }];
      const validationErrors: QueryValidationError[] = [];

      validateParametersAgainstDatasourceMetadata(
        parameters,
        sampleMetadataResponse,
        validationErrors,
      );

      expect(validationErrors).toHaveLength(1);
      expect(validationErrors[0]).toEqual({
        parameter: 'Test Date',
        message:
          "Parameter 'Test Date' was provided a value that is greater than the maximum allowed date of 2026-01-01.",
      });
    });

    it('should allow date at boundary (minDate)', () => {
      const parameters: QueryParameter[] = [{ parameterCaption: 'Test Date', value: '2024-01-01' }];
      const validationErrors: QueryValidationError[] = [];

      validateParametersAgainstDatasourceMetadata(
        parameters,
        sampleMetadataResponse,
        validationErrors,
      );

      expect(validationErrors).toHaveLength(0);
    });

    it('should allow date at boundary (maxDate)', () => {
      const parameters: QueryParameter[] = [{ parameterCaption: 'Test Date', value: '2026-01-01' }];
      const validationErrors: QueryValidationError[] = [];

      validateParametersAgainstDatasourceMetadata(
        parameters,
        sampleMetadataResponse,
        validationErrors,
      );

      expect(validationErrors).toHaveLength(0);
    });
  });

  describe('QUANTITATIVE_RANGE parameter type validation', () => {
    it('should allow numeric value within range', () => {
      const parameters: QueryParameter[] = [{ parameterCaption: 'Top Customers', value: 10 }];
      const validationErrors: QueryValidationError[] = [];

      validateParametersAgainstDatasourceMetadata(
        parameters,
        sampleMetadataResponse,
        validationErrors,
      );

      expect(validationErrors).toHaveLength(0);
    });

    it('should add error for non-numeric value', () => {
      const parameters: QueryParameter[] = [{ parameterCaption: 'Top Customers', value: 'ten' }];
      const validationErrors: QueryValidationError[] = [];

      validateParametersAgainstDatasourceMetadata(
        parameters,
        sampleMetadataResponse,
        validationErrors,
      );

      expect(validationErrors).toHaveLength(1);
      expect(validationErrors[0]).toEqual({
        parameter: 'Top Customers',
        message:
          "Parameter 'Top Customers' is a quantitative range parameter, and can only be assigned numerical values.",
      });
    });

    it('should add error for value below minimum', () => {
      const parameters: QueryParameter[] = [{ parameterCaption: 'Top Customers', value: 3 }];
      const validationErrors: QueryValidationError[] = [];

      validateParametersAgainstDatasourceMetadata(
        parameters,
        sampleMetadataResponse,
        validationErrors,
      );

      expect(validationErrors).toHaveLength(1);
      expect(validationErrors[0]).toEqual({
        parameter: 'Top Customers',
        message:
          "Parameter 'Top Customers' was provided a value that is less than the minimum allowed value of 5.",
      });
    });

    it('should add error for value above maximum', () => {
      const parameters: QueryParameter[] = [{ parameterCaption: 'Top Customers', value: 25 }];
      const validationErrors: QueryValidationError[] = [];

      validateParametersAgainstDatasourceMetadata(
        parameters,
        sampleMetadataResponse,
        validationErrors,
      );

      expect(validationErrors).toHaveLength(1);
      expect(validationErrors[0]).toEqual({
        parameter: 'Top Customers',
        message:
          "Parameter 'Top Customers' was provided a value that is greater than the maximum allowed value of 20.",
      });
    });

    it('should allow value at boundary (min)', () => {
      const parameters: QueryParameter[] = [{ parameterCaption: 'Top Customers', value: 5 }];
      const validationErrors: QueryValidationError[] = [];

      validateParametersAgainstDatasourceMetadata(
        parameters,
        sampleMetadataResponse,
        validationErrors,
      );

      expect(validationErrors).toHaveLength(0);
    });

    it('should allow value at boundary (max)', () => {
      const parameters: QueryParameter[] = [{ parameterCaption: 'Top Customers', value: 20 }];
      const validationErrors: QueryValidationError[] = [];

      validateParametersAgainstDatasourceMetadata(
        parameters,
        sampleMetadataResponse,
        validationErrors,
      );

      expect(validationErrors).toHaveLength(0);
    });

    it('should allow value when max is null (no upper bound)', () => {
      const parameters: QueryParameter[] = [{ parameterCaption: 'Test Float', value: 1000.5 }];
      const validationErrors: QueryValidationError[] = [];

      validateParametersAgainstDatasourceMetadata(
        parameters,
        sampleMetadataResponse,
        validationErrors,
      );

      expect(validationErrors).toHaveLength(0);
    });

    it('should add error for value below min when max is null', () => {
      const parameters: QueryParameter[] = [{ parameterCaption: 'Test Float', value: 1.0 }];
      const validationErrors: QueryValidationError[] = [];

      validateParametersAgainstDatasourceMetadata(
        parameters,
        sampleMetadataResponse,
        validationErrors,
      );

      expect(validationErrors).toHaveLength(1);
      expect(validationErrors[0]).toEqual({
        parameter: 'Test Float',
        message:
          "Parameter 'Test Float' was provided a value that is less than the minimum allowed value of 1.5.",
      });
    });
  });

  describe('multiple parameter validation errors', () => {
    it('should accumulate multiple validation errors', () => {
      const parameters: QueryParameter[] = [
        { parameterCaption: 'Nonexistent Parameter', value: 'test' },
        { parameterCaption: 'Test Int', value: 100 },
        { parameterCaption: 'Top Customers', value: 'not a number' },
      ];
      const validationErrors: QueryValidationError[] = [];

      validateParametersAgainstDatasourceMetadata(
        parameters,
        sampleMetadataResponse,
        validationErrors,
      );

      expect(validationErrors).toHaveLength(3);
    });
  });

  describe('edge cases', () => {
    it('should handle empty parameters array', () => {
      const parameters: QueryParameter[] = [];
      const validationErrors: QueryValidationError[] = [];

      validateParametersAgainstDatasourceMetadata(
        parameters,
        sampleMetadataResponse,
        validationErrors,
      );

      expect(validationErrors).toHaveLength(0);
    });

    it('should handle metadata with no parameters', () => {
      const parameters: QueryParameter[] = [{ parameterCaption: 'Some Parameter', value: 'test' }];
      const validationErrors: QueryValidationError[] = [];
      const metadataWithNoParams: MetadataResponse = {
        data: [],
        extraData: { parameters: [] },
      };

      validateParametersAgainstDatasourceMetadata(
        parameters,
        metadataWithNoParams,
        validationErrors,
      );

      expect(validationErrors).toHaveLength(1);
      expect(validationErrors[0]).toMatchObject({
        parameter: 'Some Parameter',
      });
    });

    it('should handle metadata with undefined extraData', () => {
      const parameters: QueryParameter[] = [{ parameterCaption: 'Some Parameter', value: 'test' }];
      const validationErrors: QueryValidationError[] = [];
      const metadataWithNoExtraData: MetadataResponse = {
        data: [],
      };

      validateParametersAgainstDatasourceMetadata(
        parameters,
        metadataWithNoExtraData,
        validationErrors,
      );

      expect(validationErrors).toHaveLength(1);
    });
  });
});
