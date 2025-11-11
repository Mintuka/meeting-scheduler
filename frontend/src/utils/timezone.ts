const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

const makeDateTimeFormatter = (timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

type DateTimeParts = {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
};

const extractParts = (date: Date, timeZone: string): DateTimeParts => {
  const parts = makeDateTimeFormatter(timeZone).formatToParts(date);
  const getPart = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return {
    year: getPart('year'),
    month: getPart('month'),
    day: getPart('day'),
    hour: getPart('hour'),
    minute: getPart('minute'),
  };
};

const getTimeZoneOffsetMs = (timeZone: string, date: Date) => {
  const parts = extractParts(date, timeZone);
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute)
  );
  return asUtc - date.getTime();
};

export const getBrowserTimeZone = () => browserTimeZone;

export const getMeetingTimeZone = (
  meeting?: { metadata?: Record<string, any> } | null,
  fallback?: string
) => {
  const metadata = meeting?.metadata || {};
  return (
    metadata.requested_timezone ||
    metadata.timezone ||
    metadata.time_zone ||
    metadata.selected_timezone ||
    fallback ||
    getBrowserTimeZone()
  );
};

export const formatDateInputValue = (date: Date, timeZone: string) => {
  const { year, month, day } = extractParts(date, timeZone);
  return `${year}-${month}-${day}`;
};

export const formatTimeInputValue = (date: Date, timeZone: string) => {
  const { hour, minute } = extractParts(date, timeZone);
  return `${hour}:${minute}`;
};

export const buildDateTimeInTimeZone = (
  dateStr?: string,
  timeStr?: string,
  timeZone?: string
): Date | null => {
  if (!dateStr || !timeStr || !timeZone) {
    return null;
  }
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute] = timeStr.split(':').map(Number);
  if ([year, month, day, hour, minute].some((value) => Number.isNaN(value))) {
    return null;
  }
  const baseUtc = Date.UTC(year, month - 1, day, hour, minute);
  const offset = getTimeZoneOffsetMs(timeZone, new Date(baseUtc));
  return new Date(baseUtc - offset);
};

const formatWithOptions = (date: Date, timeZone: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-US', { timeZone, ...options }).format(date);

export const formatFriendlyDateTime = (date: Date, timeZone: string) => {
  const formatted = formatWithOptions(date, timeZone, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const lastComma = formatted.lastIndexOf(',');
  if (lastComma === -1) {
    return formatted;
  }
  return `${formatted.slice(0, lastComma)} ·${formatted.slice(lastComma + 1)}`.trim();
};

export const formatTimeOnly = (date: Date, timeZone: string) =>
  formatWithOptions(date, timeZone, { hour: 'numeric', minute: '2-digit' });

export const formatMonthDayTime = (date: Date, timeZone: string) =>
  formatWithOptions(date, timeZone, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

export const formatDateOnly = (date: Date, timeZone: string) =>
  formatWithOptions(date, timeZone, {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
  });

export const getTimeZoneAbbreviation = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'short',
    hour: 'numeric',
  }).formatToParts(date);
  return parts.find((part) => part.type === 'timeZoneName')?.value ?? timeZone;
};

export const formatFullRange = (start: Date, end: Date, timeZone: string) => {
  const startLabel = formatFriendlyDateTime(start, timeZone);
  const endLabel = formatTimeOnly(end, timeZone);
  const tzAbbrev = getTimeZoneAbbreviation(start, timeZone);
  return `${startLabel} – ${endLabel} (${tzAbbrev})`;
};
