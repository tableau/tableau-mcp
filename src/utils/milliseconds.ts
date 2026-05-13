export const milliseconds = {
  fromSeconds: (seconds: number) => seconds * 1000,
  fromMinutes: (minutes: number) => minutes * 60 * 1000,
  fromHours: (hours: number) => hours * 60 * 60 * 1000,
  fromDays: (days: number) => days * 24 * 60 * 60 * 1000,
  fromWeeks: (weeks: number) => weeks * 7 * 24 * 60 * 60 * 1000,
  fromMonths: (months: number) => months * 30 * 24 * 60 * 60 * 1000,
  fromYears: (years: number) => years * 365.25 * 24 * 60 * 60 * 1000,
};
