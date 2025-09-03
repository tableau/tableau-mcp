import { describe, expect, it, vi } from 'vitest';

import { useRestApi } from '../../../restApiInstance.js';
import { Server } from '../../../server.js';
import { getGenerateInsightBriefTool } from './generateInsightBrief.js';

// Mock the dependencies
vi.mock('../../../restApiInstance.js');
const mockUseRestApi = vi.mocked(useRestApi);

const mockServer = new Server();

// Mock metric context data based on the sample request
const mockMetricContext = [
    {
        metadata: {
            name: 'Analytics Cloud CX - # of Doc Bugs Closed',
            metric_id: 'd7bdfcac-d83c-4033-8dec-4c2e9a5f7ff2',
            definition_id: 'fcc8efcf-bf55-4259-bccf-0b410c4419c9',
            tags: [],
        },
        metric: {
            definition: {
                datasource: {
                    id: 'b8be809b-0c44-48f8-83e2-4ee4b12446b2',
                },
                is_running_total: false,
                viz_state_specification: {
                    viz_state_string: '{"vizState":{"rows":[{"fieldOnShelf":{"component":["usr:Calculation_1055578753213030:qk"]},"fieldCaption":"AGG(Calculation_1055578753213030)"}]}}',
                },
            },
            metric_specification: {
                filters: [],
                measurement_period: {
                    granularity: 'GRANULARITY_BY_MONTH',
                    range: 'RANGE_CURRENT_PARTIAL',
                },
                comparison: {
                    comparison: 'TIME_COMPARISON_PREVIOUS_PERIOD',
                    comparison_period_override: [],
                },
            },
            extension_options: {
                allowed_dimensions: ['Team Name', 'Product Tag Name', 'Created By Name'],
                allowed_granularities: ['GRANULARITY_BY_DAY', 'GRANULARITY_BY_WEEK', 'GRANULARITY_BY_MONTH'],
                offset_from_today: 0,
                correlation_candidate_definition_ids: [],
                use_dynamic_offset: false,
            },
            representation_options: {
                type: 'NUMBER_FORMAT_TYPE_NUMBER',
                number_units: {
                    singular_noun: '',
                    plural_noun: '',
                },
                sentiment_type: 'SENTIMENT_TYPE_NONE',
                row_level_id_field: {
                    identifier_col: '',
                    identifier_label: '',
                },
                row_level_entity_names: {
                    entity_name_singular: '',
                    entity_name_plural: '',
                },
                row_level_name_field: {
                    name_col: '',
                },
                currency_code: 'CURRENCY_CODE_USD',
            },
            insights_options: {
                show_insights: true,
                settings: [
                    {
                        type: 'INSIGHT_TYPE_TOP_DRIVERS',
                        disabled: false,
                    },
                ],
            },
            candidates: [],
        },
    },
];

// Mock response data based on the sample response
const mockBriefResponse = {
    markup: 'The increase in document bugs closed for Analytics Cloud CX was driven by contributions from specific product tags and individuals.',
    generation_id: 'd853e55d-1371-4097-8df7-161d2be34695',
    source_insights: [
        {
            type: 'top-drivers',
            version: 1,
            content: '',
            markup: 'Compared to last month, Analytics Cloud CX - # of Doc Bugs Closed increased by 3.',
            viz: {
                data: {
                    values: [
                        {
                            entityName: 'Tableau CX-CP',
                            formattedValue: '+2',
                            value: 2.0,
                        },
                    ],
                },
            },
            facts: {
                change_value: {
                    raw: 3.0,
                    formatted: '3',
                },
            },
            characterization: 'CHARACTERIZATION_UNSPECIFIED',
            question: 'Which Product Tag Name increased the most?',
            score: 0.5944444444444443,
            id: 'd456e673-70c3-44bc-984a-8a315c2ed879',
            insight_feedback_metadata: {
                type: 'top-drivers',
                score: 0.5944444444444443,
                dimension_hash: 'YdzlM0A7uzJlosHHkhSpG7plfoKkLTGW1734uQLHLfw=',
                candidate_definition_id: '',
            },
            generation_id: '',
        },
    ],
    follow_up_questions: [
        {
            content: 'What actions were taken by contributors to close more bugs?',
            metric_group_context_resolved: false,
        },
    ],
    group_context: mockMetricContext,
    not_enough_information: false,
};

describe('generateInsightBrief', () => {
    it('should create the tool with correct configuration', () => {
        const tool = getGenerateInsightBriefTool(mockServer);

        expect(tool.name).toBe('generate-insight-brief');
        expect(tool.annotations?.title).toBe('Generate Pulse Insight Brief');
        expect(tool.annotations?.readOnlyHint).toBe(true);
    });

    it('should successfully generate insight brief', async () => {
        const mockGeneratePulseInsightBrief = vi.fn().mockResolvedValue(mockBriefResponse);

        mockUseRestApi.mockImplementation(async ({ callback }) => {
            const restApi = {
                pulseMethods: {
                    generatePulseInsightBrief: mockGeneratePulseInsightBrief,
                },
            };
            return await callback(restApi as any);
        });

        const tool = getGenerateInsightBriefTool(mockServer);
        const result = await tool.callback(
            {
                question: 'What happened to Analytics Cloud CX - # of Doc Bugs Closed?',
                metricContext: mockMetricContext,
            },
            {
                signal: new AbortController().signal,
                requestId: 'test',
                sendNotification: vi.fn(),
                sendRequest: vi.fn(),
            },
        );

        expect(result.isError).toBe(false);

        if (!result.isError) {
            const responseData = JSON.parse(result.content[0].text);
            expect(responseData.markup).toContain('Analytics Cloud CX');
            expect(responseData.generation_id).toBe('d853e55d-1371-4097-8df7-161d2be34695');
            expect(responseData.source_insights).toHaveLength(1);
            expect(responseData.follow_up_questions).toHaveLength(1);
            expect(responseData.not_enough_information).toBe(false);
        }

        // Verify the API was called with correct parameters
        expect(mockGeneratePulseInsightBrief).toHaveBeenCalledWith({
            messages: [
                {
                    role: 'ROLE_USER',
                    content: 'What happened to Analytics Cloud CX - # of Doc Bugs Closed?',
                    metric_group_context: mockMetricContext,
                },
            ],
        });
    });

    it('should handle API errors gracefully', async () => {
        const mockError = new Error('API Error');
        mockUseRestApi.mockRejectedValue(mockError);

        const tool = getGenerateInsightBriefTool(mockServer);
        const result = await tool.callback(
            {
                question: 'What happened to the metrics?',
                metricContext: mockMetricContext,
            },
            {
                signal: new AbortController().signal,
                requestId: 'test',
                sendNotification: vi.fn(),
                sendRequest: vi.fn(),
            },
        );

        expect(result.isError).toBe(true);
        if (result.isError) {
            expect(result.content[0].text).toContain('API Error');
        }
    });
});
