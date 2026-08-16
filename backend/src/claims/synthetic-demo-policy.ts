import type { ClaimCategory } from "./claim";

export interface SyntheticDemoPolicyProfile {
  profileId: string;
  version: string;
  displayName: string;
  source: "synthetic_demo";
  defaultSubmissionWindowDays: number | null;
  categoryOverrides: Partial<Record<ClaimCategory, number>>;
}

export interface SubmissionTiming {
  profile: Pick<SyntheticDemoPolicyProfile, "profileId" | "version" | "displayName" | "source">;
  configuredWindowDays: number | null;
  applicableDate: string | null;
  deadline: string | null;
  state: "available" | "unavailable";
  reason: "calculated" | "no_rule" | "date_unavailable";
}

export function syntheticDemoPolicyProfile(
  environment: Record<string, string | undefined> = process.env
): SyntheticDemoPolicyProfile {
  return {
    profileId: "sahl-synthetic-submission-timing",
    version: "1",
    displayName: "Sahl synthetic demo submission timing",
    source: "synthetic_demo",
    defaultSubmissionWindowDays: optionalDays(environment.SYNTHETIC_DEMO_SUBMISSION_WINDOW_DAYS),
    categoryOverrides: {
      inpatient_surgery: optionalDays(environment.SYNTHETIC_DEMO_INPATIENT_WINDOW_DAYS) ?? undefined,
      dental: optionalDays(environment.SYNTHETIC_DEMO_DENTAL_WINDOW_DAYS) ?? undefined,
      optical: optionalDays(environment.SYNTHETIC_DEMO_OPTICAL_WINDOW_DAYS) ?? undefined,
      other_outpatient: optionalDays(environment.SYNTHETIC_DEMO_OUTPATIENT_WINDOW_DAYS) ?? undefined
    }
  };
}

export function calculateSubmissionTiming(
  category: ClaimCategory | undefined,
  applicableDate: string | null,
  profile = syntheticDemoPolicyProfile()
): SubmissionTiming {
  const configuredWindowDays = category
    ? profile.categoryOverrides[category] ?? profile.defaultSubmissionWindowDays
    : profile.defaultSubmissionWindowDays;
  const trace = {
    profile: {
      profileId: profile.profileId,
      version: profile.version,
      displayName: profile.displayName,
      source: profile.source
    },
    configuredWindowDays,
    applicableDate
  };
  if (configuredWindowDays === null) {
    return { ...trace, deadline: null, state: "unavailable", reason: "no_rule" };
  }
  if (!applicableDate || !/^\d{4}-\d{2}-\d{2}$/.test(applicableDate)) {
    return { ...trace, deadline: null, state: "unavailable", reason: "date_unavailable" };
  }
  const date = new Date(`${applicableDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== applicableDate) {
    return { ...trace, deadline: null, state: "unavailable", reason: "date_unavailable" };
  }
  date.setUTCDate(date.getUTCDate() + configuredWindowDays);
  return {
    ...trace,
    deadline: date.toISOString().slice(0, 10),
    state: "available",
    reason: "calculated"
  };
}

function optionalDays(value: string | undefined) {
  if (value === undefined || value.trim() === "") return null;
  const days = Number(value);
  return Number.isInteger(days) && days >= 0 && days <= 3650 ? days : null;
}
