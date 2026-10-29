export const BUSINESS_TIME_ZONE = "Asia/Kolkata";

const dateParts = (date: Date): Record<string, string> =>
  Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: BUSINESS_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(date)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, value]),
  );

export const todayInBusinessTimeZone = (now = new Date()): string => {
  const parts = dateParts(now);
  return `${parts.year}-${parts.month}-${parts.day}`;
};

export const calendarDateToUtc = (value: string): Date =>
  new Date(`${value}T00:00:00.000Z`);

export const dateToCalendarString = (value: Date): string =>
  value.toISOString().slice(0, 10);

export const currentMonthInBusinessTimeZone = (now = new Date()): string =>
  todayInBusinessTimeZone(now).slice(0, 7);

export const latestAllowedChargeMonth = (now = new Date()): string => {
  const [yearText, monthText] = currentMonthInBusinessTimeZone(now).split("-");
  const nextMonth = new Date(
    Date.UTC(Number(yearText), Number(monthText) - 1 + 1, 1),
  );
  return `${nextMonth.getUTCFullYear()}-${String(nextMonth.getUTCMonth() + 1).padStart(2, "0")}`;
};

export const isoWeekInBusinessTimeZone = (date: string): string => {
  const value = calendarDateToUtc(date);
  const day = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((value.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
  );
  return `${value.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
};
