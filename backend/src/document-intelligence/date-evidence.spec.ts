import { isValidDateEvidence, parseDateEvidence } from "./date-evidence";

describe("date evidence integrity", () => {
  it.each([
    ["2026-08-05", "complete", 5, 8, 2026, "2026-08-05"],
    ["August 2026", "month_year", null, 8, 2026, null],
    ["2026", "year", null, null, 2026, null],
    ["05 Aug", "day_month", 5, 8, null, null],
    ["05 / 2026", "day_year", 5, null, 2026, null],
    ["05", "ambiguous", null, null, null, null],
    ["31/02/2026", "invalid", 31, 2, 2026, null],
    ["2026-13-05", "invalid", 5, 13, 2026, null],
    ["03/04/2026", "ambiguous", 3, 4, 2026, null]
  ])("preserves %s without inventing components", (raw, precision, day, month, year, normalized) => {
    expect(parseDateEvidence("serviceDate", raw)).toEqual({
      field: "serviceDate",
      rawText: raw,
      day,
      month,
      year,
      precision,
      normalizedDate: normalized
    });
  });

  it("rejects provider date evidence that claims an inconsistent complete date", () => {
    expect(isValidDateEvidence({
      field: "invoiceDate",
      rawText: "31 February 2026",
      day: 31,
      month: 2,
      year: 2026,
      precision: "complete",
      normalizedDate: "2026-02-31"
    })).toBe(false);
    expect(isValidDateEvidence({
      field: "invoiceDate",
      rawText: "5 August 2026",
      day: 5,
      month: 8,
      year: 2026,
      precision: "complete",
      normalizedDate: "2026-08-06"
    })).toBe(false);
  });

  it("accepts a consistent complete date and never accepts a normalized partial date", () => {
    expect(isValidDateEvidence({
      field: "serviceDate",
      rawText: "5 August 2026",
      day: 5,
      month: 8,
      year: 2026,
      precision: "complete",
      normalizedDate: "2026-08-05"
    })).toBe(true);
    expect(isValidDateEvidence({
      field: "serviceDate",
      rawText: "August 2026",
      day: null,
      month: 8,
      year: 2026,
      precision: "month_year",
      normalizedDate: "2026-08-01"
    })).toBe(false);
  });
});
