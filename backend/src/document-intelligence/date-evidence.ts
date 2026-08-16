export const DATE_FIELDS = [
  "invoiceDate",
  "serviceDate",
  "admissionDate",
  "dischargeDate"
] as const;

export type DateField = (typeof DATE_FIELDS)[number];
export type DatePrecision =
  | "complete"
  | "month_year"
  | "year"
  | "day_month"
  | "day_year"
  | "ambiguous"
  | "invalid";

export interface DateEvidence {
  field: DateField;
  serviceLineIndex?: number | null;
  rawText: string;
  day: number | null;
  month: number | null;
  year: number | null;
  precision: DatePrecision;
  normalizedDate: string | null;
}

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3,
  april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7,
  august: 8, aug: 8, september: 9, sep: 9, sept: 9,
  october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12
};

export function parseDateEvidence(field: DateField, rawValue: string): DateEvidence {
  const rawText = rawValue.trim();
  const base = { field, rawText, day: null, month: null, year: null };

  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(rawText);
  if (match) {
    const [, year, month, day] = match.map(Number);
    const normalizedDate = validCalendarDate(year, month, day)
      ? `${pad(year, 4)}-${pad(month)}-${pad(day)}`
      : null;
    return {
      ...base,
      day,
      month,
      year,
      precision: normalizedDate ? "complete" : "invalid",
      normalizedDate
    };
  }

  match = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(rawText);
  if (match) {
    const first = Number(match[1]);
    const second = Number(match[2]);
    const year = Number(match[3]);
    if (first <= 12 && second <= 12) {
      return { ...base, day: first, month: second, year, precision: "ambiguous", normalizedDate: null };
    }
    const day = first;
    const month = second;
    const normalizedDate = validCalendarDate(year, month, day)
      ? `${pad(year, 4)}-${pad(month)}-${pad(day)}`
      : null;
    return { ...base, day, month, year, precision: normalizedDate ? "complete" : "invalid", normalizedDate };
  }

  match = /^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/i.exec(rawText);
  if (match && MONTHS[match[2].toLowerCase()]) {
    const day = Number(match[1]);
    const month = MONTHS[match[2].toLowerCase()];
    const year = Number(match[3]);
    const normalizedDate = validCalendarDate(year, month, day)
      ? `${pad(year, 4)}-${pad(month)}-${pad(day)}`
      : null;
    return { ...base, day, month, year, precision: normalizedDate ? "complete" : "invalid", normalizedDate };
  }

  match = /^([a-z]+)\s+(\d{4})$/i.exec(rawText);
  if (match && MONTHS[match[1].toLowerCase()]) {
    return { ...base, month: MONTHS[match[1].toLowerCase()], year: Number(match[2]), precision: "month_year", normalizedDate: null };
  }

  match = /^(\d{1,2})\s+([a-z]+)$/i.exec(rawText);
  if (match && MONTHS[match[2].toLowerCase()]) {
    return { ...base, day: Number(match[1]), month: MONTHS[match[2].toLowerCase()], precision: "day_month", normalizedDate: null };
  }

  match = /^(\d{1,2})\s*[/.-]\s*(\d{4})$/.exec(rawText);
  if (match) {
    return { ...base, day: Number(match[1]), year: Number(match[2]), precision: "day_year", normalizedDate: null };
  }

  if (/^\d{4}$/.test(rawText)) {
    return { ...base, year: Number(rawText), precision: "year", normalizedDate: null };
  }

  return { ...base, precision: /^\d{1,2}$/.test(rawText) ? "ambiguous" : "invalid", normalizedDate: null };
}

export function isValidDateEvidence(value: unknown): value is DateEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<DateEvidence>;
  const structurallyValid = DATE_FIELDS.includes(item.field as DateField) &&
    typeof item.rawText === "string" && item.rawText.length <= 100 &&
    (item.serviceLineIndex === undefined || item.serviceLineIndex === null ||
      Number.isInteger(item.serviceLineIndex) && item.serviceLineIndex >= 0) &&
    validPart(item.day) && validPart(item.month) && validPart(item.year) &&
    ["complete", "month_year", "year", "day_month", "day_year", "ambiguous", "invalid"].includes(item.precision as string) &&
    (item.normalizedDate === null || typeof item.normalizedDate === "string");
  if (!structurallyValid) return false;

  if (item.precision !== "complete") return item.normalizedDate === null;
  if (typeof item.day !== "number" || typeof item.month !== "number" || typeof item.year !== "number" ||
      typeof item.normalizedDate !== "string" ||
      !validCalendarDate(item.year, item.month, item.day)) {
    return false;
  }
  return item.normalizedDate === `${pad(item.year, 4)}-${pad(item.month)}-${pad(item.day)}`;
}

export function dateEvidenceFor(
  field: DateField,
  value: string | null,
  evidence: readonly DateEvidence[] | undefined,
  serviceLineIndex: number | null = null
): DateEvidence | null {
  const supplied = evidence?.find((item) =>
    item.field === field && (item.serviceLineIndex ?? null) === serviceLineIndex
  );
  if (value) {
    const parsed = parseDateEvidence(field, value);
    if (!supplied || parsed.normalizedDate !== supplied.normalizedDate) return parsed;
  }
  return supplied ?? (value ? parseDateEvidence(field, value) : null);
}

function validPart(value: unknown) {
  return value === null || Number.isInteger(value);
}

function validCalendarDate(year: number, month: number, day: number) {
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function pad(value: number, width = 2) {
  return String(value).padStart(width, "0");
}
