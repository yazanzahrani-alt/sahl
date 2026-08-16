import { calculateSubmissionTiming, syntheticDemoPolicyProfile } from "./synthetic-demo-policy";
import { validateEnvironment } from "../environment";

describe("synthetic demo submission timing", () => {
  it("calculates only from an explicit complete date and configured synthetic rule", () => {
    const profile = syntheticDemoPolicyProfile({
      SYNTHETIC_DEMO_SUBMISSION_WINDOW_DAYS: "30"
    });
    expect(calculateSubmissionTiming("dental", "2026-08-05", profile)).toMatchObject({
      configuredWindowDays: 30,
      deadline: "2026-09-04",
      state: "available",
      reason: "calculated"
    });
  });

  it("supports a category override without representing it as Bupa policy", () => {
    const profile = syntheticDemoPolicyProfile({
      SYNTHETIC_DEMO_SUBMISSION_WINDOW_DAYS: "30",
      SYNTHETIC_DEMO_OPTICAL_WINDOW_DAYS: "45"
    });
    const result = calculateSubmissionTiming("optical", "2026-08-05", profile);
    expect(result.configuredWindowDays).toBe(45);
    expect(result.profile.source).toBe("synthetic_demo");
  });

  it("returns an honest unavailable state for missing rules or dates", () => {
    const noRule = syntheticDemoPolicyProfile({});
    const configured = syntheticDemoPolicyProfile({
      SYNTHETIC_DEMO_SUBMISSION_WINDOW_DAYS: "30"
    });
    expect(calculateSubmissionTiming("dental", "2026-08-05", noRule)).toMatchObject({
      deadline: null,
      reason: "no_rule"
    });
    expect(calculateSubmissionTiming("dental", null, configured)).toMatchObject({
      deadline: null,
      reason: "date_unavailable"
    });
    expect(calculateSubmissionTiming("dental", "2026-02-31", configured)).toMatchObject({
      deadline: null,
      reason: "date_unavailable"
    });
  });

  it("contains no benefit, reimbursement, entitlement, or adjudication values", () => {
    const serialized = JSON.stringify(syntheticDemoPolicyProfile({}));
    expect(serialized).not.toMatch(/benefit|reimbursement|entitlement|approval|adjudication/i);
  });

  it("rejects malformed timing configuration without weakening required environment checks", () => {
    expect(() => validateEnvironment({
      WEB_ORIGIN: "http://localhost:5175",
      SYNTHETIC_DEMO_SUBMISSION_WINDOW_DAYS: "90.5"
    })).toThrow("must be a whole number");
    expect(validateEnvironment({
      WEB_ORIGIN: "http://localhost:5175",
      SYNTHETIC_DEMO_SUBMISSION_WINDOW_DAYS: "90"
    })).toBeTruthy();
  });
});
