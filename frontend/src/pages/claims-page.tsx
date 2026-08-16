import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/auth-context";
import { claimsApi, localizedApiError } from "../lib/api";
import type { ClaimSummary } from "../types";
import { DiscardDraftButton } from "../components/discard-draft-button";
import { HeaderUtilities } from "../components/demo-ops-launcher";
import { SahlBrand } from "../components/brand-mark";
import { useLanguage, type Language } from "../i18n/language-context";
import { Button, DelayedPageState, PageState, StateIcon } from "../components/ui";
import {
  claimJourneyActionLabel,
  claimJourneyDestination
} from "../lib/claim-journey";

interface LocationState {
  accountCreated?: boolean;
}
export function ClaimsPage({
  initialClaims
}: {
  initialClaims?: ClaimSummary[];
} = {}) {
  const { language, isArabic } = useLanguage();
  const { member, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [loggingOut, setLoggingOut] = useState(false);
  const [claims, setClaims] = useState<ClaimSummary[]>(initialClaims ?? []);
  const [claimsLoading, setClaimsLoading] = useState(initialClaims === undefined);
  const [claimsError, setClaimsError] = useState<string | null>(null);
  const [, setGreetingTick] = useState(0);
  const state = location.state as LocationState | null;
  const linkedFromGovernmentId =
    member?.memberIdSource === "synthetic" &&
    member.identifierType !== "member_id";

  async function loadClaims() {
    setClaimsLoading(true);
    setClaimsError(null);

    try {
      setClaims(await claimsApi.list());
    } catch (error) {
      setClaimsError(localizedApiError(error, isArabic, "تعذر تحميل سجل المطالبات. حاول مرة أخرى.", "We could not load your claim history. Please try again."));
    } finally {
      setClaimsLoading(false);
    }
  }

  useEffect(() => {
    if (member && initialClaims === undefined) {
      void loadClaims();
    }
  }, [member?.memberId, initialClaims]);

  useEffect(() => {
    let timer = 0;
    function scheduleNext() {
      timer = window.setTimeout(() => {
        setGreetingTick((tick) => tick + 1);
        scheduleNext();
      }, msUntilGreetingChanges());
    }
    scheduleNext();
    return () => window.clearTimeout(timer);
  }, []);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
      navigate("/login", { replace: true });
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <main className="sahl-app min-h-screen bg-[#f4f7fb] text-[#0b1e3d]">
      <header className="sahl-topbar border-b border-[#dce6f0] bg-white/95 backdrop-blur">
        <div className="mx-auto flex min-h-14 max-w-4xl items-center justify-between gap-2 px-4 py-2 sm:px-6">
          <SahlBrand compact />

          <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
            <HeaderUtilities />
            <div className="hidden rounded-lg bg-[#f7fafd] px-3 py-1.5 text-end sm:block">
              <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#8a9bbb]">
                {isArabic ? "رقم العضوية" : "Member ID"}
              </p>
              <p className="mt-0.5 text-xs font-extrabold tracking-[0.04em] text-[#425979] sm:text-sm">
                {member?.memberId}
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleLogout}
              loading={loggingOut}
            >
              {loggingOut
                ? isArabic ? "جارٍ تسجيل الخروج…" : "Signing out…"
                : isArabic ? "تسجيل الخروج" : "Sign out"}
            </Button>
          </div>
        </div>
      </header>

      <section className="dashboard-claim-hero prototype-dashboard-hero overflow-hidden text-white">
        <ClaimsHeroEcg />
        <div className="relative z-10 mx-auto max-w-4xl px-4 pb-32 pt-12 sm:px-6 sm:pb-36 sm:pt-16">
          <div className="max-w-xl">
            <h1 className="text-3xl font-black tracking-[-0.04em] sm:text-4xl">
              {timeGreeting(isArabic)}
            </h1>
            {member && (
              <p className="mt-2 text-sm text-white/70">
                {isArabic ? "رقم العضوية" : "Member ID"} {member.memberId}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Lifted over the hero's lower edge so the primary action reads as the
          first thing on the page rather than part of the banner. The hero is
          position:relative, so it paints after in-flow siblings — this needs an
          explicit stacking position to sit in front of it, not behind. */}
      <div className="relative z-20 mx-auto max-w-4xl px-4 sm:px-6">
        <div className="claims-primary-action -mt-14 flex flex-col gap-4 rounded-2xl border border-white/80 bg-white p-6 shadow-[0_18px_48px_rgba(19,61,93,0.14)] sm:-mt-16 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:p-7">
          <div className="min-w-0">
            <h2 className="text-lg font-extrabold text-[#0b1e3d]">
              {isArabic ? "ابدأ مطالبة جديدة" : "Start a new claim"}
            </h2>
            <p className="mt-1.5 text-sm leading-6 text-[#687a96]">
              {isArabic
                ? "ارفع إيصالاتك ومستنداتك الطبية — نستخرج التفاصيل تلقائياً."
                : "Upload your receipts and medical documents — we extract the details automatically."}
            </p>
          </div>
          <Button
            size="lg"
            onClick={() => navigate("/claims/new")}
            className="shrink-0"
          >
            {isArabic ? "بدء مطالبة جديدة" : "Start new claim"}
            <span aria-hidden="true" className="directional-next-icon">→</span>
          </Button>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-4 py-8 pb-24 sm:px-6 sm:py-9">
        {state?.accountCreated && (
          <div className="mb-7 flex items-start gap-3 rounded-2xl border border-[#b8ded4] bg-[#effaf6] px-5 py-4 text-sm text-[#276758]">
            <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#3c9a81] text-xs text-white">
              ✓
            </span>
            <div>
              <p className="font-extrabold">
                {isArabic ? "ملفك جاهز" : "Your profile is ready"}
              </p>
              <p className="mt-1 leading-5 text-[#4f7a70]">
                {linkedFromGovernmentId
                  ? isArabic
                    ? `تم ربط تسجيل دخولك برقم العضوية ${member.memberId}. يمكنك استخدام كلمة المرور نفسها مع أي من الرقمين.`
                    : `We linked your sign-in to Member ID ${member.memberId}. Use the same password with either identifier.`
                  : isArabic
                    ? "استخدم رقم العضوية وكلمة المرور نفسيهما عند العودة."
                    : "Use the same Member ID and password when you return."}
              </p>
            </div>
          </div>
        )}

        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#8a9bbb]">
            {isArabic ? "مطالباتي" : "My claims"}
          </p>
          {!claimsLoading && !claimsError && claims.length > 0 && (
            <span className="grid h-6 min-w-[1.5rem] place-items-center rounded-full bg-[#e8edf5] px-2 text-xs font-bold text-[#687a96]">
              {claims.length}
            </span>
          )}
        </div>
        <section className="claims-list-card rounded-2xl border border-[#e8edf5] bg-white">
          {claimsLoading ? (
            <DelayedPageState
              inline
              title={isArabic ? "جارٍ تحميل مطالباتك" : "Loading your claims"}
              description={isArabic ? "جارٍ جمع المسودات والمطالبات المرسلة." : "Bringing together your drafts and submitted claims."}
            />
          ) : claimsError ? (
            <PageState
              inline
              tone="error"
              title={isArabic ? "سجل المطالبات غير متاح" : "Your claim history is unavailable"}
              description={claimsError}
              actionLabel={isArabic ? "حاول مرة أخرى" : "Try again"}
              onAction={() => void loadClaims()}
            />
          ) : claims.length === 0 ? (
            <div className="grid min-h-[300px] place-items-center px-6 py-12 text-center">
              <div className="max-w-md">
                <div className="relative mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-[#eef6fd] text-[#005eb8]">
                  <StateIcon tone="empty" />
                  <span
                    aria-hidden="true"
                    className="absolute -bottom-1.5 -end-1.5 grid h-7 w-7 place-items-center rounded-full bg-[#005eb8] text-base font-bold leading-none text-white ring-4 ring-white"
                  >
                    +
                  </span>
                </div>
                <h3 className="mt-5 text-lg font-extrabold text-[#0b1e3d]">
                  {isArabic ? "لا توجد مطالبات بعد" : "No claims yet"}
                </h3>
                <p className="mt-2 text-sm leading-6 text-[#687a96]">
                  {isArabic
                    ? "ستظهر مطالباتك المرسلة هنا لتتمكن من متابعة حالتها."
                    : "Your submitted claims will appear here so you can track their status."}
                </p>
                <Button
                  size="lg"
                  onClick={() => navigate("/claims/new")}
                  className="mt-6 rounded-full"
                >
                  <span aria-hidden="true">+</span>
                  {isArabic ? "أرسل مطالبتك الأولى" : "Submit your first claim"}
                </Button>
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-[#e8edf5]">
              {claims.map((claim, index) => (
                <li
                  key={claim.claimId}
                  className="claim-list-row group relative py-4 pe-5 ps-6 transition-colors hover:bg-[#f7fafd] focus-within:bg-[#f7fafd] sm:pe-6 sm:ps-7"
                >
                  {/* Rounded to follow the card's corners on the first and last
                      rows. The list itself must not clip, or the discard menu
                      gets cut off inside it. */}
                  <span
                    aria-hidden="true"
                    className={`absolute bottom-0 start-0 top-0 w-1.5 ${statusAccent(claim)} ${
                      index === 0 ? "rounded-ss-2xl" : ""
                    } ${index === claims.length - 1 ? "rounded-es-2xl" : ""}`}
                  />
                  <button
                    type="button"
                    className="absolute inset-0 z-0 rounded-none focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0072ce]"
                    aria-label={`${isArabic ? "عرض المطالبة" : "View claim"} ${claim.claimId}`}
                    onClick={() => navigate(claimJourneyDestination(claim))}
                  />
                  <article className="pointer-events-none relative z-[1] flex items-start gap-3 py-0.5 sm:items-center sm:gap-4">
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-[15px] font-semibold leading-5 text-[#0b1e3d] sm:text-base">
                        {formatCategory(claim.category, claim.opticalItem, language)}
                      </h3>
                      <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs leading-5 text-[#8a9bbb]">
                        <span className="font-medium text-[#687a96]">{claim.claimId}</span>
                        <span aria-hidden="true">·</span>
                        <span>{isArabic ? "آخر تحديث" : "Updated"} {formatDate(claim.updatedAt, language)}</span>
                      </p>
                    </div>
                    <ClaimStatusBadge claim={claim} language={language} />
                    <div className="relative z-10 flex shrink-0 items-center gap-2">
                      <span className="max-w-24 text-end text-[10px] font-extrabold leading-4 text-[#316a73] sm:max-w-none sm:text-xs">
                        {claimJourneyActionLabel(claim.journey, isArabic)}
                      </span>
                      {claim.status !== "accepted_for_processing" && (
                        <div className="pointer-events-auto">
                          <DiscardDraftButton
                            claimId={claim.claimId}
                            menu
                            onDiscarded={() => setClaims((current) =>
                              current.filter((item) => item.claimId !== claim.claimId)
                            )}
                          />
                        </div>
                      )}
                      <span
                        aria-hidden="true"
                        className="directional-next-icon grid h-10 w-8 place-items-center rounded-full text-lg text-[#8a9bbb] transition group-hover:bg-[#eef6fd] group-hover:text-[#005eb8] sm:h-8"
                      >
                        →
                      </span>
                    </div>
                  </article>
                </li>
              ))}
            </ul>
          )}
        </section>

      </div>
      <footer className="mx-auto max-w-4xl border-t border-[#e8edf5] px-4 py-6 text-xs text-[#b0bac9] sm:px-6">© {new Date().getFullYear()} Bupa Arabia</footer>
    </main>
  );
}

function ClaimsHeroEcg() {
  return (
    <svg
      aria-hidden="true"
      className="claims-hero-ecg pointer-events-none absolute inset-x-0 -bottom-[14%] h-[124%] w-full"
      viewBox="0 0 1200 220"
      preserveAspectRatio="none"
    >
      <path
        className="claims-hero-ecg__base"
        pathLength="100"
        d="M0 138h260c35 0 49-8 66-29l24 40 40-106 50 155 44-88 25 28h180c34 0 49-7 65-26l19 31 31-78 40 119 31-65 20 19h325"
      />
      <path
        className="claims-hero-ecg__pulse"
        pathLength="100"
        d="M0 138h260c35 0 49-8 66-29l24 40 40-106 50 155 44-88 25 28h180c34 0 49-7 65-26l19 31 31-78 40 119 31-65 20 19h325"
      />
    </svg>
  );
}

/** The rail down the start edge of a claim row, so status reads before the text does. */
function statusAccent(claim: ClaimSummary) {
  if (claim.journey.phase === "analysis_required" || claim.journey.phase === "validation_required") {
    return "bg-[#e0a112]";
  }
  const status = claim.status;
  return {
    draft: "bg-[#c9dcec]",
    processing: "bg-[#005eb8]",
    needs_review: "bg-[#e0a112]",
    ready: "bg-[#005eb8]",
    accepted_for_processing: "bg-[#3c9a81]"
  }[status];
}

function timeGreeting(isArabic: boolean) {
  const hour = new Date().getHours();
  if (hour < 12) return isArabic ? "صباح الخير" : "Good morning";
  if (hour < 17) return isArabic ? "مساء الخير" : "Good afternoon";
  return isArabic ? "مساء الخير" : "Good evening";
}

// Keep these boundaries in step with timeGreeting above.
function msUntilGreetingChanges() {
  const now = new Date();
  const hour = now.getHours();
  const next = new Date(now);

  if (hour < 12) {
    next.setHours(12, 0, 0, 0);
  } else if (hour < 17) {
    next.setHours(17, 0, 0, 0);
  } else {
    next.setDate(next.getDate() + 1);
    next.setHours(0, 0, 0, 0);
  }

  // setHours/setDate work in local time, so a DST shift moves the boundary with
  // the clock. Clamp in case that leaves us at or behind now.
  return Math.max(1000, next.getTime() - now.getTime());
}

function formatCategory(
  category: ClaimSummary["category"],
  opticalItem: ClaimSummary["opticalItem"],
  language: Language
) {
  if (category === "optical" && opticalItem) {
    if (language === "ar") {
      return `البصريات — ${opticalItem === "frames" ? "الإطار" : opticalItem === "lenses" ? "العدسات" : "الإطار والعدسات"}`;
    }
    return `Optical — ${opticalItem === "frames" ? "Frames" : opticalItem === "lenses" ? "Lenses" : "Frames and lenses"}`;
  }

  return (language === "ar" ? {
    inpatient_surgery: "التنويم والجراحة",
    dental: "الأسنان",
    optical: "البصريات",
    other_outpatient: "أخرى / عيادات خارجية"
  } : {
    inpatient_surgery: "Inpatient and Surgery",
    dental: "Dental",
    optical: "Optical",
    other_outpatient: "Other / Outpatient"
  })[category];
}

function formatDate(value: string, language: Language) {
  return new Intl.DateTimeFormat(language === "ar" ? "ar-SA" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(new Date(value));
}

function ClaimStatusBadge({ claim, language }: { claim: ClaimSummary; language: Language }) {
  if (claim.journey.phase === "analysis_required") {
    return <span className="shrink-0 whitespace-nowrap rounded-full bg-[#fff4df] px-2 py-0.5 text-[11px] font-semibold leading-5 text-[#9a6516]">
      {language === "ar" ? "تحتاج إلى تحليل" : "Needs analysis"}
    </span>;
  }
  if (claim.journey.phase === "validation_required") {
    return <span className="shrink-0 whitespace-nowrap rounded-full bg-[#fff4df] px-2 py-0.5 text-[11px] font-semibold leading-5 text-[#9a6516]">
      {language === "ar" ? "تحتاج إلى إعادة فحص" : "Needs revalidation"}
    </span>;
  }
  const status = claim.status;
  const content = (language === "ar" ? {
    draft: { label: "مسودة", className: "bg-[#f0f4fa] text-[#687a96]" },
    processing: { label: "قيد المعالجة", className: "bg-[#eef6fd] text-[#005eb8]" },
    needs_review: { label: "تحتاج مراجعة", className: "bg-[#fff4df] text-[#9a6516]" },
    ready: { label: "جاهزة", className: "bg-[#eef6fd] text-[#005eb8]" },
    accepted_for_processing: { label: "مقبولة للمعالجة", className: "bg-[#e8f7f1] text-[#27755f]" }
  } : {
    draft: { label: "Draft", className: "bg-[#f0f4fa] text-[#687a96]" },
    processing: {
      label: "Processing",
      className: "bg-[#eef6fd] text-[#005eb8]"
    },
    needs_review: {
      label: "Needs review",
      className: "bg-[#fff4df] text-[#9a6516]"
    },
    ready: { label: "Ready", className: "bg-[#eef6fd] text-[#005eb8]" },
    accepted_for_processing: {
      label: "Accepted for processing",
      className: "bg-[#e8f7f1] text-[#27755f]"
    }
  })[status];

  return (
    <span className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold leading-5 ${content.className}`}>
      {content.label}
    </span>
  );
}
