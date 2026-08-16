import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { claimsApi, localizedApiError } from "../lib/api";
import { getCategoryGuidance } from "../lib/claim-content";
import type { ClaimCategory, ClaimLocation, OpticalItem } from "../types";
import type { ClaimStatus } from "../types";
import { DiscardDraftButton } from "../components/discard-draft-button";
import { SahlBrand } from "../components/brand-mark";
import { HeaderUtilities } from "../components/demo-ops-launcher";
import { useLanguage } from "../i18n/language-context";
import { Button, DelayedPageState, PageState } from "../components/ui";

export function NewClaimPage() {
  const { language, isArabic } = useLanguage();
  const navigate = useNavigate();
  const { claimId } = useParams();
  const [category, setCategory] = useState<ClaimCategory | null>(null);
  const [opticalItem, setOpticalItem] = useState<OpticalItem | null>(null);
  const [claimLocation, setClaimLocation] = useState<ClaimLocation>("local");
  const [creating, setCreating] = useState(false);
  const [loadingClaim, setLoadingClaim] = useState(Boolean(claimId));
  const [claimStatus, setClaimStatus] = useState<ClaimStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editing = Boolean(claimId);

  const localizedCategories = getCategoryGuidance(language);
  const categories = Object.entries(localizedCategories) as [
    ClaimCategory,
    (typeof localizedCategories)[ClaimCategory]
  ][];
  const opticalItems: Array<{ value: OpticalItem; label: string; description: string }> = [
    {
      value: "frames",
      label: isArabic ? "الإطار" : "Frames",
      description: isArabic ? "طالب بتكلفة الإطار المفصلة في الفاتورة." : "Claim the separately itemized frame cost."
    },
    {
      value: "lenses",
      label: isArabic ? "العدسات" : "Lenses",
      description: isArabic ? "طالب بتكلفة العدسات المفصلة في الفاتورة." : "Claim the separately itemized lens cost."
    },
    {
      value: "both",
      label: isArabic ? "الإطار والعدسات" : "Frames and lenses",
      description: isArabic
        ? "طالب بتكلفة الإطار والعدسات عندما توضح الفاتورة تكلفة كل منهما بشكل منفصل."
        : "Claim both when the invoice itemizes each cost separately."
    }
  ];

  useEffect(() => {
    if (!claimId) return;

    setLoadingClaim(true);
    setError(null);
    void claimsApi.get(claimId)
      .then((claim) => {
        setClaimStatus(claim.status);
        setCategory(claim.category);
        setOpticalItem(claim.opticalItem);
        setClaimLocation(claim.claimLocation);
      })
      .catch((requestError) => {
        setError(localizedApiError(requestError, isArabic, "تعذر فتح تفاصيل المطالبة. حاول مرة أخرى.", "We could not open these claim details. Please try again."));
      })
      .finally(() => setLoadingClaim(false));
  }, [claimId]);

  async function handleCreate() {
    if (!category) {
      setError(isArabic ? "اختر نوع العلاج الذي تطالب بتعويضه." : "Choose the type of treatment you are claiming for.");
      return;
    }

    if (category === "optical" && !opticalItem) {
      setError(isArabic ? "اختر الإطار أو العدسات أو كليهما لهذه المطالبة البصرية." : "Choose Frames, Lenses, or both for this optical claim.");
      return;
    }

    setCreating(true);
    setError(null);
    try {
      if (claimId) {
        await claimsApi.update(claimId, {
          category,
          claimLocation,
          ...(category === "optical" && opticalItem ? { opticalItem } : {})
        });
        navigate(`/claims/${claimId}/documents`);
      } else {
        const claim = await claimsApi.create(
          category,
          claimLocation,
          opticalItem ?? undefined
        );
        navigate(`/claims/${claim.claimId}/documents`);
      }
    } catch (requestError) {
      setError(localizedApiError(
        requestError,
        isArabic,
        editing ? "تعذر حفظ تفاصيل المطالبة. حاول مرة أخرى." : "تعذر بدء المطالبة. حاول مرة أخرى.",
        editing ? "We could not save these claim details. Please try again." : "We could not start your claim. Please try again."
      ));
      setCreating(false);
    }
  }

  if (loadingClaim) {
    return (
      <DelayedPageState
        title={isArabic ? "جارٍ فتح تفاصيل المطالبة" : "Opening claim details"}
        description={isArabic ? "جارٍ تحميل هذه المطالبة." : "Loading this claim."}
      />
    );
  }

  return (
    <main className="sahl-app prototype-claim-page min-h-screen bg-[#f4f7fb] text-[#0b1e3d]">
      <header className="sahl-topbar border-b border-[#dce6f0] bg-white/95 backdrop-blur">
        <div className="relative mx-auto flex min-h-14 max-w-2xl items-center justify-between gap-2 px-3 py-2 sm:gap-4 sm:px-6">
          <button
            type="button"
            onClick={() => navigate(editing && claimId ? `/claims/${claimId}/documents` : "/claims")}
            className="group flex items-center gap-2 rounded-xl px-2 py-2 text-sm font-medium text-[#425979] transition hover:bg-[#f7fafd]"
          >
            <BackIcon />
            {editing
              ? isArabic ? "العودة إلى المستندات" : "Back to documents"
              : isArabic ? "العودة إلى المطالبات" : "Back to claims"}
          </button>
          <div className="absolute start-1/2 hidden -translate-x-1/2 md:block rtl:translate-x-1/2"><SahlBrand compact /></div>
          <div className="flex items-center justify-end gap-2">
            <HeaderUtilities />
            {editing && claimId && claimStatus !== "accepted_for_processing" && (
              <DiscardDraftButton
                claimId={claimId}
                compact
                onDiscarded={() => navigate("/claims", { replace: true })}
              />
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
        <ProgressSteps current={1} isArabic={isArabic} />

        <section className="mt-8">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#0072ce]">
              {editing
                ? isArabic ? `المطالبة ${claimId}` : `Claim ${claimId}`
                : isArabic ? "مطالبة تعويض جديدة" : "New reimbursement claim"}
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-[#0b1e3d] sm:text-3xl">
              {editing
                ? isArabic ? "تعديل تفاصيل المطالبة" : "Edit claim details"
                : isArabic ? "ما نوع المطالبة التي ترغب في تقديمها؟" : "What are you claiming for?"}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[#687a96] sm:text-base">
              {editing
                ? isArabic
                  ? "حدّث فئة المطالبة أو موقع العلاج. ستبقى المستندات المرفوعة مرفقة."
                  : "Update the category or treatment location for this claim. Your uploaded documents will stay attached."
                : isArabic
                  ? "أنشئ مطالبة واحدة لكل زيارة أو حالة علاجية."
                  : "Start one claim for one treatment episode."}
            </p>

            {/* Two-up tiles on phones so all four categories fit without
                scrolling; the fuller card with its description returns at sm. */}
            <div className="mt-7 grid grid-cols-2 gap-3">
              {categories.map(([value, item]) => {
                const selected = category === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setCategory(value);
                      if (value !== "optical") {
                        setOpticalItem(null);
                      }
                      setError(null);
                    }}
                    className={`claim-category-card group relative flex h-full flex-col items-center rounded-2xl border p-4 text-center transition focus:outline-none focus:ring-4 focus:ring-[#0072ce]/20 sm:items-start sm:p-5 sm:text-start ${
                      selected
                        ? "border-[#0072ce] bg-[#f7fafd] shadow-[0_10px_25px_rgba(0,127,141,0.10)]"
                        : "border-[#dce6f0] bg-white hover:-translate-y-0.5 hover:border-[#82b2db] hover:shadow-md"
                    }`}
                  >
                    <span
                      className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${
                        selected
                          ? "bg-[#005eb8] text-white"
                          : "bg-[#eef6fd] text-[#005eb8]"
                      }`}
                    >
                      <CategoryIcon category={value} />
                    </span>
                    <h2 className="mt-3 text-sm font-semibold leading-5 text-[#0b1e3d] sm:mt-4 sm:text-base">
                      {item.label}
                    </h2>
                    <p className="mt-1.5 hidden text-[13px] leading-5 text-[#687a96] sm:block">
                      {item.description}
                    </p>
                    {selected && (
                      <span className="absolute end-2 top-2 grid h-5 w-5 place-items-center rounded-full bg-[#005eb8] text-[10px] text-white sm:end-4 sm:top-4 sm:h-6 sm:w-6 sm:text-xs">
                        ✓
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {category === "optical" && (
              <section className="mt-6 rounded-2xl border border-[#dce6f0] bg-[#f7fafd] p-5 sm:p-6">
                <h2 className="text-lg font-semibold tracking-[-0.015em] text-[#0b1e3d]">
                  {isArabic
                    ? "ما الذي تشمله مطالبة البصريات؟"
                    : "What's included in this optical claim?"}
                </h2>
                <p className="mt-1.5 text-sm leading-5 text-[#687a96]">
                  {isArabic
                    ? "اختر كل ما تتضمنه هذه المطالبة. يمكن المطالبة بالإطار والعدسات معًا عندما تُفصّل تكلفة كل منهما بشكل منفصل."
                    : "Select everything included in this claim. Frames and lenses can be claimed together when each cost is itemized separately."}
                </p>
                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  {opticalItems.map((item) => {
                    const selected = opticalItem === item.value;
                    return (
                      <button
                        key={item.value}
                        type="button"
                        onClick={() => {
                          setOpticalItem(item.value);
                          setError(null);
                        }}
                        className={`rounded-xl border p-4 text-start transition focus:outline-none focus:ring-4 focus:ring-[#0072ce]/20 ${
                          selected
                            ? "border-[#0072ce] bg-white shadow-sm"
                            : "border-[#dce6f0] bg-white/70 hover:border-[#82b2db] hover:bg-white"
                        }`}
                      >
                        <span className={`grid h-8 w-8 place-items-center rounded-lg ${
                          selected ? "bg-[#005eb8] text-white" : "bg-[#eef6fd] text-[#005eb8]"
                        }`}>
                          <OpticalItemIcon item={item.value} />
                        </span>
                        <span className="mt-3 block text-sm font-semibold text-[#0b1e3d]">
                          {item.label}
                        </span>
                        <span className="mt-1 block text-sm leading-5 text-[#687a96]">
                          {item.description}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            <section className="claim-location-card mt-8 rounded-2xl border border-[#dce6f0] bg-white p-5 sm:p-6">
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#eef6fd] text-[#005eb8]">
                  <PinIcon />
                </span>
                <div>
                   <h2 className="text-base font-semibold text-[#0b1e3d]">
                    {isArabic ? "أين تم تقديم العلاج؟" : "Where was the treatment provided?"}
                  </h2>
                  <p className="mt-1 text-sm leading-5 text-[#687a96]">
                    {isArabic ? "اختر موقع مقدم الخدمة أو الحالة العلاجية." : "Choose the location of the provider or treatment episode."}
                  </p>
                </div>
              </div>
              <div className="mt-5 grid grid-cols-1 gap-3 min-[380px]:grid-cols-2">
                {([
                  ["local", isArabic ? "محلية" : "Local", isArabic ? "قُدمت داخل المملكة العربية السعودية" : "Provided within Saudi Arabia"],
                  ["international", isArabic ? "دولية" : "International", isArabic ? "قُدمت خارج المملكة العربية السعودية" : "Provided outside Saudi Arabia"]
                ] as const).map(([value, label, description]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setClaimLocation(value)}
                    className={`rounded-xl border px-4 py-3 text-start transition focus:outline-none focus:ring-4 focus:ring-[#0072ce]/20 ${
                      claimLocation === value
                        ? "border-[#0072ce] bg-[#f7fafd] text-[#0b1e3d]"
                        : "border-[#dce6f0] bg-white text-[#687a96] hover:border-[#82b2db]"
                    }`}
                  >
                    <span className="block text-sm font-semibold">{label}</span>
                    <span className="mt-1 block text-xs leading-4 opacity-80">
                      {description}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          </div>

          {error && (
            <p className="mt-6 rounded-xl border border-[#f1c7bd] bg-[#fff4f1] px-4 py-3 text-sm font-medium text-[#a04432]">
              {error}
            </p>
          )}

          <div className="mt-8 flex flex-col-reverse gap-3 border-t border-[#dce6f0] pt-6 sm:flex-row sm:items-center sm:justify-end">
            <Button
              variant="ghost"
              onClick={() => navigate(editing && claimId ? `/claims/${claimId}/documents` : "/claims")}
            >
              {isArabic ? "إلغاء" : "Cancel"}
            </Button>
            <Button
              onClick={() => void handleCreate()}
              disabled={!category}
              loading={creating}
            >
              {creating
                ? editing
                  ? isArabic ? "جارٍ حفظ التغييرات…" : "Saving changes…"
                  : isArabic ? "جارٍ بدء المطالبة…" : "Starting your claim…"
                : editing
                  ? isArabic ? "حفظ والعودة إلى المستندات" : "Save and return to documents"
                  : isArabic ? "المتابعة إلى المستندات" : "Continue to documents"}
            </Button>
          </div>
        </section>
      </div>
    </main>
  );
}

function ProgressSteps({ current, isArabic }: { current: number; isArabic: boolean }) {
  const steps = isArabic
    ? ["تفاصيل المطالبة", "المستندات", "المراجعة"]
    : ["Claim details", "Documents", "Review"];
  return (
    <ol aria-label={isArabic ? "تقدم المطالبة" : "Claim progress"} className="grid grid-cols-3 gap-1 rounded-2xl border border-[#dce6f0] bg-white p-2 sm:flex sm:items-center sm:gap-0 sm:px-5">
      {steps.map((label, index) => {
        const step = index + 1;
        const complete = step < current;
        const active = step === current;
        return (
          <li key={label} aria-current={active ? "step" : undefined} className="flex min-w-0 flex-1 flex-col items-center gap-1 text-center sm:flex-row sm:gap-2 sm:text-start">
            <span
              className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-extrabold ${
                complete
                  ? "bg-[#28745f] text-white"
                  : active
                    ? "bg-[#005eb8] text-white"
                  : "bg-[#f0f4fa] text-[#687a96]"
              }`}
            >
              {complete ? "✓" : step}
            </span>
            <span
              className={`w-full text-[10px] font-bold leading-tight sm:w-auto sm:text-sm ${
                active ? "text-[#0b1e3d]" : "text-[#8a9bbb]"
              }`}
            >
              {label}
            </span>
            {step < steps.length && (
              <span className={`hidden h-px flex-1 sm:block ${step < current ? "bg-[#8bc9b7]" : "bg-[#dce6f0]"}`} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function CategoryIcon({ category }: { category: ClaimCategory }) {
  const shared = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const
  };
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      {category === "dental" && (
        <path
          d="M12 4.6C10.6 3.3 9 2.8 7.6 3.2 5.7 3.8 4.8 5.5 4.8 7.8c0 1.8.6 3.1 1 4.5.3 1.2.4 2.3.6 3.7.2 1.8.6 3.2 1.7 3.2 1.1 0 1.5-1.4 1.8-3.3.3-1.6.6-2.8 2.1-2.8s1.8 1.2 2.1 2.8c.3 1.9.7 3.3 1.8 3.3 1.1 0 1.5-1.4 1.7-3.2.2-1.4.3-2.5.6-3.7.4-1.4 1-2.7 1-4.5 0-2.3-.9-4-2.8-4.6-1.4-.4-3 .1-4.4 1.4Z"
          {...shared}
        />
      )}
      {category === "optical" && (
        <>
          <circle cx="6.6" cy="13" r="3.9" {...shared} />
          <circle cx="17.4" cy="13" r="3.9" {...shared} />
          <path d="M10.4 12.4c.9-.7 2.3-.7 3.2 0M2.7 11 5 7.2M21.3 11 19 7.2" {...shared} />
        </>
      )}
      {category === "inpatient_surgery" && (
        <>
          <rect x="3" y="10.5" width="18" height="7" rx="2" {...shared} />
          <path d="M3 14.2h18M7 10.5V8.4a1.2 1.2 0 0 1 1.2-1.2h7.6A1.2 1.2 0 0 1 17 8.4v2.1M5.6 17.5v2.2M18.4 17.5v2.2" {...shared} />
        </>
      )}
      {category === "other_outpatient" && (
        <>
          <path d="M5.2 3.4v5.2a4.6 4.6 0 0 0 9.2 0V3.4" {...shared} />
          <path d="M9.8 13.2v1.5a4.5 4.5 0 0 0 9 0v-1.9" {...shared} />
          <circle cx="18.8" cy="10.9" r="2" {...shared} />
        </>
      )}
    </svg>
  );
}

function OpticalItemIcon({ item }: { item: OpticalItem }) {
  const shared = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const
  };
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      {item === "frames" && (
        <>
          <rect x="2.5" y="9" width="8" height="6.5" rx="3" {...shared} />
          <rect x="13.5" y="9" width="8" height="6.5" rx="3" {...shared} />
          <path d="M10.5 11.8c.9-.6 2.1-.6 3 0M2.5 11.5 4.5 7.5M21.5 11.5 19.5 7.5" {...shared} />
        </>
      )}
      {item === "lenses" && (
        <>
          <circle cx="12" cy="12" r="7.5" {...shared} />
          <path d="M8.4 7.7A6 6 0 0 0 6.6 10.9" {...shared} />
        </>
      )}
      {item === "both" && (
        <>
          <circle cx="6.6" cy="13" r="3.9" {...shared} />
          <circle cx="17.4" cy="13" r="3.9" {...shared} />
          <path d="M10.4 12.4c.9-.7 2.3-.7 3.2 0M2.7 11 5 7.2M21.3 11 19 7.2" {...shared} />
        </>
      )}
    </svg>
  );
}

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" className="directional-back-icon h-4 w-4" aria-hidden="true">
      <path d="m14 6-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path d="M12 20s6-5.1 6-11a6 6 0 1 0-12 0c0 5.9 6 11 6 11Zm0-8.2A2.2 2.2 0 1 1 12 7.4a2.2 2.2 0 0 1 0 4.4Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}
