import {
  cloudSubscriptionScheduleSchema,
  createSubscriptionInputSchema,
  subscriptionSchema,
} from './subscription.js';

const id = '11111111-1111-4111-8111-111111111111';
const daily = {
  frequency: 'Daily',
  frequencyDetails: {
    start: '23:00:00',
    intervals: { interval: [{ hours: 24 }, { weekDay: 'Sunday' }] },
  },
};

describe('subscription input and response schemas', () => {
  it.each(['Workbook', 'View'])('accepts a %s Cloud subscription', (contentType) => {
    expect(
      createSubscriptionInputSchema.safeParse({
        contentType,
        contentId: id,
        subject: 'Weekly report',
        schedule: daily,
      }).success,
    ).toBe(true);
  });
  it('accepts an existing Server schedule', () => {
    expect(
      createSubscriptionInputSchema.safeParse({
        contentType: 'Workbook',
        contentId: id,
        subject: 'Report',
        schedule: { id },
      }).success,
    ).toBe(true);
  });
  it.each([
    {
      frequency: 'Hourly',
      frequencyDetails: {
        start: '06:00:00',
        end: '18:00:00',
        intervals: { interval: [{ hours: 1 }, { weekDay: 'Monday' }] },
      },
    },
    {
      frequency: 'Daily',
      frequencyDetails: {
        start: '06:00:00',
        end: '18:00:00',
        intervals: { interval: [{ hours: 4 }, { weekDay: 'Monday' }] },
      },
    },
    {
      frequency: 'Weekly',
      frequencyDetails: { start: '06:00:00', intervals: { interval: [{ weekDay: 'Monday' }] } },
    },
    {
      frequency: 'Monthly',
      frequencyDetails: {
        start: '06:00:00',
        intervals: { interval: [{ monthDay: 1 }, { monthDay: 15 }] },
      },
    },
    {
      frequency: 'Monthly',
      frequencyDetails: {
        start: '06:00:00',
        intervals: { interval: [{ monthDay: 'Third', weekDay: 'Thursday' }] },
      },
    },
    {
      frequency: 'Monthly',
      frequencyDetails: { start: '06:00:00', intervals: { interval: [{ monthDay: 'LastDay' }] } },
    },
  ])('accepts documented recurrence %#', (schedule) => {
    expect(cloudSubscriptionScheduleSchema.safeParse(schedule).success).toBe(true);
  });
  it.each([
    {
      frequency: 'Daily',
      frequencyDetails: {
        start: '6:00:00',
        intervals: { interval: [{ hours: 24 }, { weekDay: 'Monday' }] },
      },
    },
    {
      frequency: 'Hourly',
      frequencyDetails: {
        start: '06:00:00',
        intervals: { interval: [{ hours: 1 }, { weekDay: 'Monday' }] },
      },
    },
    {
      frequency: 'Daily',
      frequencyDetails: {
        start: '06:00:00',
        intervals: { interval: [{ hours: 4 }, { weekDay: 'Monday' }] },
      },
    },
    {
      frequency: 'Hourly',
      frequencyDetails: {
        start: '06:00:00',
        end: '05:00:00',
        intervals: { interval: [{ hours: 1 }, { weekDay: 'Monday' }] },
      },
    },
    {
      frequency: 'Daily',
      frequencyDetails: {
        start: '06:00:00',
        intervals: { interval: [{ hours: 3 }, { weekDay: 'Monday' }] },
      },
    },
    {
      frequency: 'Weekly',
      frequencyDetails: {
        start: '06:00:00',
        intervals: { interval: [{ weekDay: 'Monday' }, { weekDay: 'Tuesday' }] },
      },
    },
    {
      frequency: 'Monthly',
      frequencyDetails: { start: '06:00:00', intervals: { interval: [{ monthDay: 32 }] } },
    },
    {
      frequency: 'Monthly',
      frequencyDetails: { start: '06:00:00', intervals: { interval: [{ monthDay: 'Third' }] } },
    },
    {
      frequency: 'Weekly',
      frequencyDetails: { start: '06:01:00', intervals: { interval: [{ weekDay: 'Monday' }] } },
    },
  ])('rejects an invalid recurrence %#', (schedule) => {
    expect(cloudSubscriptionScheduleSchema.safeParse(schedule).success).toBe(false);
  });
  it('rejects blank subjects, no delivery, Workbook empty-view flags, and arbitrary recipients', () => {
    const input = { contentType: 'Workbook', contentId: id, subject: 'Report', schedule: { id } };
    for (const patch of [
      { subject: ' ' },
      { attachImage: false },
      { sendIfViewEmpty: true },
      { userId: id },
    ]) {
      expect(createSubscriptionInputSchema.safeParse({ ...input, ...patch }).success).toBe(false);
    }
  });
  it('parses false strings correctly and strips unrelated user metadata', () => {
    const result = subscriptionSchema.parse({
      id,
      subject: 'Report',
      suspended: 'false',
      content: { id, type: 'View' },
      user: { id, email: 'private@example.invalid' },
      secret: 'not returned',
    });
    expect(result.suspended).toBe(false);
    expect(result.user).toEqual({ id });
    expect(result).not.toHaveProperty('secret');
  });
});
