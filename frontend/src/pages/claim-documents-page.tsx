import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { apiUrl, claimsApi, localizedApiError } from "../lib/api";
import {
  formatCategory,
  getClaimGuidance
} from "../lib/claim-content";
import type { ClaimAttachment, ClaimDetail, OpticalItem } from "../types";
import { DiscardDraftButton } from "../components/discard-draft-button";
import { HeaderUtilities } from "../components/demo-ops-launcher";
import { useLanguage } from "../i18n/language-context";
import { validationIssueMessage } from "../lib/validation-copy";
import { SahlBrand } from "../components/brand-mark";
import {
  ProcessingExperience,
  type ProcessingPhase
} from "../components/processing-experience";
import { DelayedPageState, PageState } from "../components/ui";
import {
  DemoUploadNotice,
  DocumentValidationIssue
} from "../components/claim-validation-presentation";
import { claimJourneyActionLabel } from "../lib/claim-journey";

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_FILE_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png"
]);

export function ClaimDocumentsPage({
  initialClaim
}: {
  initialClaim?: ClaimDetail;
} = {}) {
  const { language, isArabic } = useLanguage();
  const navigate = useNavigate();
  const { claimId } = useParams();
  const [searchParams] = useSearchParams();
  const targetedAttachmentId = searchParams.get("attachment");
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [claim, setClaim] = useState<ClaimDetail | null>(initialClaim ?? null);
  const [loading, setLoading] = useState(initialClaim === undefined);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [savingOpticalItem, setSavingOpticalItem] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const [processingPhase, setProcessingPhase] =
    useState<ProcessingPhase>("preparing");
  const [error, setError] = useState<string | null>(null);
  const [showPhotoHint, setShowPhotoHint] = useState(false);

  async function loadClaim() {
    if (!claimId) return;

    setLoading(true);
    setError(null);
    try {
      setClaim(await claimsApi.get(claimId));
    } catch (requestError) {
      setError(localizedApiError(requestError, isArabic, "تعذر فتح هذه المطالبة. حاول مرة أخرى.", "We could not open this claim. Please try again."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (initialClaim === undefined) void loadClaim();
  }, [claimId, initialClaim]);

  useEffect(() => {
    if (selectedFiles.length === 0) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [selectedFiles.length]);

  function navigateWithStagedFileCheck(destination: string) {
    if (selectedFiles.length > 0 && !window.confirm(isArabic
      ? "الملفات التي اخترتها لم تُرفع بعد. هل تريد المغادرة دون رفعها؟"
      : "Your selected files have not been uploaded yet. Leave without uploading them?")) return;
    navigate(destination);
  }

  useEffect(() => {
    if (!claim || !targetedAttachmentId ||
        !claim.attachments.some((item) => item.attachmentId === targetedAttachmentId)) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`attachment-${targetedAttachmentId}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [claim, targetedAttachmentId]);

  function addFiles(files: File[]) {
    const accepted: File[] = [];
    const rejected: string[] = [];

    for (const file of files) {
      const extension = file.name.split(".").pop()?.toLowerCase();
      const extensionIsSupported = ["pdf", "jpg", "jpeg", "png"].includes(
        extension ?? ""
      );

      if (!ACCEPTED_FILE_TYPES.has(file.type) || !extensionIsSupported) {
        rejected.push(isArabic
          ? `${file.name} ليس ملف PDF أو JPG أو PNG مدعوماً.`
          : `${file.name} is not a supported PDF, JPG, or PNG.`);
      } else if (file.size > MAX_FILE_SIZE_BYTES) {
        rejected.push(isArabic
          ? `${file.name} أكبر من 10 ميجابايت.`
          : `${file.name} is larger than 10 MB.`);
      } else {
        accepted.push(file);
      }
    }

    const existingKeys = new Set(
      selectedFiles.map((file) => `${file.name}-${file.size}-${file.lastModified}`)
    );
    const uniqueFiles = accepted.filter((file) => {
      const key = `${file.name}-${file.size}-${file.lastModified}`;
      if (existingKeys.has(key)) return false;
      existingKeys.add(key);
      return true;
    });

    setSelectedFiles((current) => [...current, ...uniqueFiles].slice(0, 10));
    setError(
      rejected.length > 0
        ? rejected[0]
        : accepted.length + selectedFiles.length > 10
          ? isArabic ? "يمكنك رفع حتى 10 مستندات في المرة." : "Upload up to 10 documents at a time."
          : null
    );
  }

  async function uploadFiles() {
    if (!claimId || selectedFiles.length === 0) {
      setError(isArabic ? "اختر مستنداً واحداً على الأقل لرفعه." : "Choose at least one document to upload.");
      return;
    }

    if (claim?.category === "optical" && !claim.opticalItem) {
      setError(isArabic ? "اختر الإطار أو العدسات أو كليهما قبل رفع المستندات." : "Choose Frames, Lenses, or both before uploading documents.");
      return;
    }

    setUploading(true);
    setError(null);
    try {
      await claimsApi.upload(claimId, selectedFiles);
      setClaim(await claimsApi.get(claimId));
      setSelectedFiles([]);
    } catch (requestError) {
      setError(localizedApiError(requestError, isArabic, "تعذر رفع المستندات. حاول مرة أخرى.", "We could not upload your documents. Please try again."));
    } finally {
      setUploading(false);
    }
  }

  async function removeAttachment(attachment: ClaimAttachment) {
    if (!claimId) return;

    setRemovingId(attachment.attachmentId);
    setError(null);
    try {
      await claimsApi.removeAttachment(claimId, attachment.attachmentId);
      setClaim(await claimsApi.get(claimId));
    } catch (requestError) {
      setError(localizedApiError(requestError, isArabic, "تعذر حذف المستند. حاول مرة أخرى.", "We could not remove that document. Please try again."));
    } finally {
      setRemovingId(null);
    }
  }

  async function continueFromDocuments() {
    if (!claimId || !claim || claim.attachments.length === 0) return;

    setContinuing(true);
    setProcessingPhase("preparing");
    setError(null);
    const startedAt = Date.now();
    const checkingTimer = window.setTimeout(
      () => setProcessingPhase("checking"),
      850
    );
    const extractingTimer = window.setTimeout(
      () => setProcessingPhase("extracting"),
      1900
    );
    try {
      const updated = await claimsApi.continueFromDocuments(claimId);
      setClaim(updated);

      const incomplete = updated.attachments.filter(
        (attachment) => attachment.analysis?.analysisStatus !== "complete"
      );
      const needsConfiguration = incomplete.some(
        (attachment) => attachment.analysis?.analysisStatus === "needs_configuration"
      );

      if (needsConfiguration) {
        setError(
          isArabic
            ? "قراءة المستندات غير مهيأة لبيئة العرض هذه. اطلب من مسؤول العرض إعداد الخادم، ثم حاول مجدداً. ملفاتك المرفوعة محفوظة."
            : "Document reading is not configured for this demo environment. Ask the demo administrator to configure the server, then try again. Your uploaded files are saved."
        );
      } else if (incomplete.length > 0) {
        setError(
          isArabic
            ? `تعذرت قراءة ${incomplete.length === 1 ? "مستند واحد" : `${incomplete.length} مستندات`}. ملفاتك محفوظة. تحقق من الاتصال وحاول المتابعة مجدداً.`
            : `We could not read ${incomplete.length === 1 ? "one document" : `${incomplete.length} documents`}. Your uploaded files are saved. Check the connection and continue again.`
        );
      } else if (updated.validation) {
        const remainingMinimum = Math.max(0, 2600 - (Date.now() - startedAt));
        if (remainingMinimum > 0) await delay(remainingMinimum);
        setProcessingPhase("validating");
        await delay(550);
        setProcessingPhase("review");
        await delay(500);
        navigate(`/claims/${claimId}/review`);
      }
    } catch (requestError) {
      setError(localizedApiError(requestError, isArabic, "تعذر تجهيز مستنداتك. حاول مرة أخرى.", "We could not prepare your documents. Please try again."));
    } finally {
      window.clearTimeout(checkingTimer);
      window.clearTimeout(extractingTimer);
      setContinuing(false);
    }
  }

  function resumeFromDocuments() {
    if (!claimId || !claim) return;
    if (claim.journey.phase === "review") {
      navigate(`/claims/${claimId}/review`);
      return;
    }
    void continueFromDocuments();
  }

  async function chooseOpticalItem(item: OpticalItem) {
    if (!claimId || !claim) return;

    setSavingOpticalItem(true);
    setError(null);
    try {
      await claimsApi.update(claimId, { opticalItem: item });
      setClaim(await claimsApi.get(claimId));
    } catch (requestError) {
      setError(localizedApiError(requestError, isArabic, "تعذر حفظ عنصر المطالبة البصرية. حاول مرة أخرى.", "We could not save your Optical claim item. Please try again."));
    } finally {
      setSavingOpticalItem(false);
    }
  }

  if (loading) {
    return <DelayedPageState
      title={isArabic ? "جارٍ فتح مطالبتك" : "Opening your claim"}
      description={isArabic ? "جارٍ تحميل المسودة ومستنداتها." : "Loading your draft and its documents."}
    />;
  }

  if (!claim) {
    return (
      <PageState
        tone="error"
        title={isArabic ? "تعذر فتح هذه المطالبة" : "We could not open this claim"}
        description={error ?? (isArabic ? "قد لا تكون المطالبة متاحة بعد الآن." : "The claim may no longer be available.")}
        actionLabel={isArabic ? "العودة إلى المطالبات" : "Return to claims"}
        onAction={() => navigate("/claims")}
      />
    );
  }

  if (claim.journey.phase === "submitted") {
    return <Navigate to={`/claims/${claim.claimId}/submitted`} replace />;
  }

  const guidance = getClaimGuidance(claim.category, claim.opticalItem, language);
  const needsOpticalItem =
    claim.category === "optical" && claim.opticalItem === null;
  const documentsPrepared =
    claim.journey.phase === "review" &&
    claim.validation !== null &&
    claim.attachments.length > 0 &&
    claim.attachments.every(
      (attachment) => attachment.analysis?.analysisStatus === "complete"
    );
  const hasFailedAnalysis = claim.attachments.some(
    (attachment) =>
      attachment.analysis?.analysisStatus === "failed" ||
      attachment.analysis?.analysisStatus === "needs_configuration"
  );
  const documentBlockingCount = claim.validation?.issues.filter(
    (issue) => issue.severity === "blocking_error"
  ).length ?? 0;
  const documentWarningCount = claim.validation?.issues.filter(
    (issue) => issue.severity === "warning"
  ).length ?? 0;
  const documentInfoCount = claim.validation?.issues.filter(
    (issue) => issue.severity === "info"
  ).length ?? 0;

  return (
    <main className="sahl-app prototype-claim-page min-h-screen bg-[#f4f7fb] text-[#0b1e3d]">
      <header className="sahl-topbar border-b border-[#dce6f0] bg-white/95 backdrop-blur">
        <div className="relative mx-auto flex min-h-14 max-w-2xl items-center justify-between gap-2 px-3 py-2 sm:gap-4 sm:px-6">
          <button
            type="button"
            onClick={() => navigateWithStagedFileCheck("/claims")}
            className="group flex items-center gap-2 rounded-xl px-2 py-2 text-sm font-medium text-[#425979] transition hover:bg-[#f7fafd]"
          >
            <BackIcon />
            {isArabic ? "حفظ والعودة" : "Save and return"}
          </button>
          <div className="absolute start-1/2 hidden -translate-x-1/2 md:block rtl:translate-x-1/2"><SahlBrand compact /></div>
          <div className="flex items-center justify-end gap-2">
            <HeaderUtilities />
            {claim.status !== "accepted_for_processing" && (
              <DiscardDraftButton
                claimId={claim.claimId}
                compact
                onDiscarded={() => navigate("/claims", { replace: true })}
              />
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
        <ProgressSteps
          isArabic={isArabic}
          onClaimDetails={() => navigateWithStagedFileCheck(`/claims/${claim.claimId}/details`)}
        />

        <section className="mt-8 grid gap-6">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#0072ce]">
              {isArabic ? "المطالبة" : "Claim"} {claim.claimId}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-[-0.02em] text-[#0b1e3d] sm:text-3xl">
                {isArabic ? "ارفع مستنداتك" : "Upload your documents"}
              </h1>
              <span className="rounded-full bg-[#eef6fd] px-2.5 py-1 text-[11px] font-semibold text-[#005eb8]">
                {formatCategory(claim.category, claim.opticalItem, language)}
              </span>
            </div>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[#687a96] sm:text-base">
              {isArabic
                ? "أضف المستندات الخاصة بهذه الحالة العلاجية فقط. يمكنك رفع الفاتورة التفصيلية وإثبات الدفع والمستندات الطبية المطلوبة معاً."
                : "Add documents for this treatment episode only. You can upload an itemized invoice, proof of payment, and any required supporting medical documents together."}
            </p>

            <section className="upload-guidance-card mt-6 overflow-hidden rounded-[20px] border border-[#e8edf5] bg-white">
              <div className="border-b border-[#f0f4fa] px-5 py-4 sm:px-6">
                <p className="text-[10px] font-black uppercase tracking-[0.1em] text-[#8a9bbb]">
                  {isArabic ? "المستندات المطلوبة" : "What to upload"}
                </p>
                <h2 className="mt-1 text-lg font-extrabold text-[#0b1e3d]">{guidance.label}</h2>
              </div>
              <div className="grid gap-5 px-5 py-5 sm:grid-cols-2 sm:px-6">
                <Checklist title={isArabic ? "مطلوب" : "Required"} items={guidance.required} />
                {guidance.conditional.length > 0 && (
                  <Checklist title={isArabic ? "عند الحاجة" : "If applicable"} items={guidance.conditional} subtle />
                )}
              </div>
              <p className="border-t border-[#f4e4bb] bg-[#fdf8ea] px-5 py-3 text-sm leading-5 text-[#8a6218] sm:px-6">
                {isArabic
                  ? "إذا كانت الفاتورة التفصيلية توضح أنها مدفوعة، فيمكن أن تغطي متطلب الفاتورة وإثبات الدفع معاً."
                  : "A paid itemized invoice can satisfy both the invoice and proof-of-payment requirement when payment is clearly shown."}
              </p>
            </section>

            <div className="mt-4">
              <DemoUploadNotice isArabic={isArabic} />
            </div>

            {needsOpticalItem && (
              <section className="mt-7 rounded-[24px] border border-[#dce6f0] bg-[#f7fafd] p-6 shadow-[0_12px_35px_rgba(38,79,89,0.06)]">
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#0072ce]">
                  {isArabic ? "خطوة سريعة" : "One quick step"}
                </p>
                <h2 className="mt-2 text-lg font-semibold tracking-[-0.015em] text-[#0b1e3d]">
                  {isArabic ? "ما الذي تشمله مطالبة البصريات؟" : "What's included in this optical claim?"}
                </h2>
                <p className="mt-2 max-w-xl text-sm leading-6 text-[#687a96]">
                  {isArabic
                    ? "اختر كل ما تتضمنه هذه المطالبة البصرية قبل إضافة المستندات."
                    : "Choose everything included in this Optical claim before adding documents."}
                </p>
                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  {(["frames", "lenses", "both"] as const).map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => void chooseOpticalItem(item)}
                      disabled={savingOpticalItem}
                      className="rounded-xl border border-[#d5e5e7] bg-white p-4 text-start transition hover:border-[#87bdc3] hover:shadow-sm focus:outline-none focus:ring-4 focus:ring-[#0072ce]/15 disabled:cursor-wait disabled:opacity-60"
                    >
                      <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#eef6fd] text-xs font-black text-[#005eb8]">
                        {item === "frames" ? "F" : item === "lenses" ? "L" : "F+L"}
                      </span>
                      <span className="mt-3 block font-extrabold capitalize text-[#0b1e3d]">
                        {isArabic
                          ? item === "frames" ? "الإطار" : item === "lenses" ? "العدسات" : "الإطار والعدسات"
                          : item === "both" ? "Frames and lenses" : item}
                      </span>
                      <span className="mt-1 block text-sm leading-5 text-[#687a96]">
                        {item === "frames"
                          ? isArabic ? "طالب بتكلفة الإطار المفصلة بشكل منفصل." : "Claim the separately itemized frame cost."
                          : item === "lenses"
                            ? isArabic ? "طالب بتكلفة العدسات المفصلة بشكل منفصل." : "Claim the separately itemized lens cost."
                            : isArabic ? "طالب بتكلفة الإطار والعدسات المفصلتين بشكل منفصل." : "Claim both separately itemized costs."}
                      </span>
                    </button>
                  ))}
                </div>
                {error && (
                  <p className="mt-5 rounded-xl border border-[#f1c7bd] bg-[#fff4f1] px-4 py-3 text-sm font-medium text-[#a04432]">
                    {error}
                  </p>
                )}
              </section>
            )}

            {!needsOpticalItem && <section className="upload-panel mt-7 rounded-[24px] border border-[#dce6f0] bg-white p-5 shadow-[0_12px_35px_rgba(38,79,89,0.06)] sm:p-7">
              <input
                ref={inputRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                multiple
                className="sr-only"
                onChange={(event) => {
                  addFiles(Array.from(event.target.files ?? []));
                  event.target.value = "";
                }}
              />
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/jpeg,image/png"
                capture="environment"
                className="sr-only"
                onChange={(event) => {
                  addFiles(Array.from(event.target.files ?? []));
                  event.target.value = "";
                }}
              />
              <div
                onDragEnter={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={(event) => {
                  event.preventDefault();
                  setDragging(false);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  addFiles(Array.from(event.dataTransfer.files));
                }}
                className={`upload-dropzone rounded-2xl border-2 border-dashed px-5 py-9 text-center transition sm:px-8 ${
                  dragging
                    ? "border-[#0072ce] bg-[#f7fafd]"
                    : "border-[#dce6f0] bg-[#f7fafd] hover:border-[#82b2db] hover:bg-[#eef6fd]"
                }`}
              >
                <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#eef6fd] text-[#005eb8]">
                  <UploadIcon />
                </span>
                <h2 className="mt-4 text-lg font-extrabold text-[#0b1e3d]">
                  {isArabic ? "اسحب المستندات هنا أو اختر الملفات" : "Drop documents here, or choose files"}
                </h2>
                <p className="mt-2 text-sm leading-5 text-[#687a96]">
                  {isArabic
                    ? "PDF أو JPG أو PNG · حتى 10 ميجابايت لكل ملف · حتى 10 ملفات في المرة"
                    : "PDF, JPG, or PNG · up to 10 MB per file · up to 10 files at a time"}
                </p>
                <div className="mt-5 flex flex-col justify-center gap-2.5 sm:flex-row">
                  <button type="button" onClick={() => inputRef.current?.click()} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#005eb8] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#004f9f] focus:outline-none focus:ring-4 focus:ring-[#005eb8]/20">
                    <UploadIcon small />
                    {isArabic ? "رفع ملفات" : "Upload files"}
                  </button>
                  <button type="button" onClick={() => { setShowPhotoHint(true); cameraInputRef.current?.click(); }} className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#bfd4e7] bg-white px-5 py-2.5 text-sm font-semibold text-[#005eb8] transition hover:border-[#82b2db] hover:bg-[#f4f9fd] focus:outline-none focus:ring-4 focus:ring-[#005eb8]/10">
                    <CameraIcon />
                    {isArabic ? "التقاط صورة" : "Take photo"}
                  </button>
                </div>
                {showPhotoHint && <p className="mt-3 text-xs text-[#687a96]">{isArabic ? "اجعل المستند كاملاً داخل الإطار وتجنب الوهج." : "Keep the entire document in frame and avoid glare."}</p>}
              </div>

              {selectedFiles.length > 0 && (
                <div className="mt-6 rounded-2xl border border-[#dce6f0] bg-[#f7fafd] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="font-extrabold text-[#425979]">
                        {isArabic ? "جاهزة للرفع" : "Ready to upload"}
                      </h2>
                      <p className="mt-1 text-sm text-[#687a96]">
                        {isArabic ? "راجع الملفات أدناه قبل إضافتها إلى المسودة." : "Review the files below before adding them to this draft."}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedFiles([])}
                      disabled={uploading}
                      className="text-sm font-bold text-[#617e84] transition hover:text-[#174f59] disabled:opacity-50"
                    >
                      {isArabic ? "مسح الاختيار" : "Clear selection"}
                    </button>
                  </div>
                  <ul className="mt-4 space-y-2">
                    {selectedFiles.map((file) => (
                      <li key={`${file.name}-${file.size}-${file.lastModified}`} className="flex items-center gap-3 rounded-xl bg-white px-3 py-3">
                        <FileIcon mimeType={file.type} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-bold text-[#425979]">{file.name}</p>
                          <p className="mt-0.5 text-xs text-[#8a9bbb]">{formatBytes(file.size)}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedFiles((files) => files.filter((item) => item !== file))
                          }
                          disabled={uploading}
                          className="rounded-lg px-2 py-1 text-xs font-bold text-[#9a5545] transition hover:bg-[#fff0ed] disabled:opacity-50"
                        >
                          {isArabic ? "إزالة" : "Remove"}
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    onClick={() => void uploadFiles()}
                    disabled={uploading}
                    className="mt-4 w-full rounded-xl bg-[#005eb8] px-5 py-3 text-sm font-extrabold text-white transition hover:bg-[#004f9f] focus:outline-none focus:ring-4 focus:ring-[#0072ce]/20 disabled:bg-[#a5c6c9]"
                  >
                    {uploading
                      ? isArabic ? "جارٍ رفع المستندات…" : "Uploading documents…"
                      : isArabic
                        ? `رفع ${selectedFiles.length} ${selectedFiles.length === 1 ? "مستند" : "مستندات"}`
                        : `Upload ${selectedFiles.length} ${selectedFiles.length === 1 ? "document" : "documents"}`}
                  </button>
                </div>
              )}

              {error && (
                <p className="mt-5 rounded-xl border border-[#f1c7bd] bg-[#fff4f1] px-4 py-3 text-sm font-medium text-[#a04432]">
                  {error}
                </p>
              )}
            </section>}

            <section className="documents-list-card mt-6 overflow-hidden rounded-[24px] border border-[#dce6f0] bg-white shadow-[0_12px_35px_rgba(38,79,89,0.06)]">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e8edf5] px-5 py-5 sm:px-6">
                <div>
                  <h2 className="font-extrabold text-[#0b1e3d]">
                    {isArabic ? "مستنداتك" : "Your documents"}
                  </h2>
                  <p className="mt-1 text-sm text-[#687a96]">
                    {isArabic ? "هذه الملفات محفوظة في مسودة المطالبة." : "These files are saved to this claim draft."}
                  </p>
                </div>
                <span className="rounded-full bg-[#f0f4fa] px-3 py-1 text-xs font-bold text-[#687a96]">
                  {claim.attachments.length} {isArabic
                    ? claim.attachments.length === 1 ? "ملف" : "ملفات"
                    : claim.attachments.length === 1 ? "file" : "files"}
                </span>
              </div>
              {claim.attachments.length === 0 ? (
                <div className="px-6 py-10 text-center">
                  <DocumentIcon />
                  <h3 className="mt-4 font-extrabold text-[#425979]">
                    {isArabic ? "لم تُرفع مستندات بعد" : "No documents uploaded yet"}
                  </h3>
                  <p className="mt-2 text-sm leading-5 text-[#687a96]">
                    {isArabic ? "ابدأ بفاتورة وإثبات دفع لهذه الحالة العلاجية." : "Start with the invoice and proof of payment for this treatment episode."}
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-[#e8edf5]">
                  {claim.attachments.map((attachment) => {
                    const isTargeted = attachment.attachmentId === targetedAttachmentId;
                    return (
                    <li
                      key={attachment.attachmentId}
                      id={`attachment-${attachment.attachmentId}`}
                      data-targeted={isTargeted ? "true" : undefined}
                      className={`flex flex-wrap items-start gap-3 px-5 py-4 transition sm:px-6 ${isTargeted ? "bg-[#fff8ec] ring-2 ring-inset ring-[#d7a34b]" : ""}`}
                    >
                      <FileIcon mimeType={attachment.mimeType} />
                      <div className="min-w-0 flex-1">
                        {isTargeted && <p className="mb-1 text-[11px] font-extrabold uppercase tracking-wide text-[#8a6118]">{isArabic ? "المستند المطلوب مراجعته" : "Document to review"}</p>}
                        <a
                          href={apiUrl(`/claims/${claim.claimId}/attachments/${attachment.attachmentId}/download`)}
                          target="_blank"
                          rel="noreferrer"
                          className="block truncate text-sm font-extrabold text-[#005eb8] transition hover:underline"
                        >
                          {attachment.originalFilename}
                        </a>
                        <p className="mt-0.5 text-xs text-[#8a9bbb]">
                          {formatBytes(attachment.sizeBytes)} · {isArabic ? "محفوظ في هذه المطالبة" : "Saved to this claim"}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void removeAttachment(attachment)}
                        disabled={removingId === attachment.attachmentId}
                        className="rounded-lg px-2.5 py-1.5 text-xs font-bold text-[#9a5545] transition hover:bg-[#fff0ed] disabled:opacity-50"
                      >
                        {removingId === attachment.attachmentId
                          ? isArabic ? "جارٍ الإزالة…" : "Removing…"
                          : isArabic ? "إزالة" : "Remove"}
                      </button>
                    </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {!needsOpticalItem && (
              <section className="documents-next-step mt-6 rounded-[24px] border border-[#dce6f0] bg-[#f7fafd] p-5 shadow-[0_12px_35px_rgba(38,79,89,0.06)] sm:p-6">
                {documentsPrepared && claim.validation ? (
                  <div className="flex gap-3">
                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl text-sm font-black ${documentBlockingCount > 0 ? "bg-[#fff0ed] text-[#a04c39]" : documentWarningCount > 0 ? "bg-[#fff0dc] text-[#8a6118]" : "bg-[#eef6fd] text-[#005eb8]"}`}>
                      {claim.validation.readyToSubmit && documentWarningCount === 0 ? "✓" : "!"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <h2 className="font-extrabold text-[#0b1e3d]">
                        {claim.validation.readyToSubmit
                          ? documentWarningCount > 0
                            ? isArabic ? "جاهزة للمراجعة مع تنبيهات" : "Ready to review with warnings"
                            : isArabic ? "اكتملت فحوصات الإرسال" : "Submission checks complete"
                          : isArabic
                            ? `${claim.validation.issues.length} ${claim.validation.issues.length === 1 ? "عنصر" : "عناصر"} للمراجعة`
                            : `${claim.validation.issues.length} ${claim.validation.issues.length === 1 ? "item" : "items"} to review`}
                      </h2>
                      <p className="mt-1 text-sm leading-5 text-[#687a96]">
                        {claim.validation.readyToSubmit
                          ? documentWarningCount > 0
                            ? isArabic ? "راجع التنبيهات أدناه. لا تمنع الإرسال." : "Review the warnings below. They do not block submission."
                            : documentInfoCount > 0
                              ? isArabic ? "راجع المعلومات أدناه. لا تتطلب إجراءً." : "Review the information below. It requires no action."
                              : isArabic ? "لم يتم العثور على مشكلات. مطالبتك جاهزة للمراجعة النهائية." : "No issues were found. Your claim is ready for final review."
                          : documentBlockingCount > 0
                            ? isArabic ? "عالج الإجراءات المطلوبة قبل إرسال المطالبة." : "Fix the required actions before the claim can be submitted."
                            : isArabic ? "راجع هذه التنبيهات. لا تمنع الإرسال." : "Review these warnings. They do not block submission."}
                      </p>
                      {claim.validation.issues.length > 0 && (
                        <ul className="mt-3 space-y-2">
                          {claim.validation.issues.map((issue) => (
                            <DocumentValidationIssue
                              key={`${issue.code}-${issue.attachmentId ?? "claim"}`}
                              issue={issue}
                              message={validationIssueMessage(issue, isArabic)}
                              isArabic={isArabic}
                            />
                          ))}
                        </ul>
                      )}
                      <button
                        type="button"
                        onClick={resumeFromDocuments}
                        className="mt-5 w-full rounded-xl bg-[#005eb8] px-5 py-3 text-sm font-extrabold text-white transition hover:bg-[#004f9f] focus:outline-none focus:ring-4 focus:ring-[#0072ce]/20"
                      >
                        {claimJourneyActionLabel(claim.journey, isArabic)}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <h2 className="font-extrabold text-[#0b1e3d]">
                      {isArabic ? "جاهز للمتابعة؟" : "Ready to continue?"}
                    </h2>
                    <p className="mt-1 text-sm leading-5 text-[#687a96]">
                      {isArabic
                        ? "سنقرأ المستندات المرفوعة ونجهز المطالبة للفحص والمراجعة."
                        : "We’ll read the documents you uploaded and prepare the claim for its checks and review."}
                    </p>
                    <button
                      type="button"
                      onClick={resumeFromDocuments}
                      disabled={claim.attachments.length === 0 || uploading || removingId !== null || continuing}
                      className="mt-5 w-full rounded-xl bg-[#005eb8] px-5 py-3 text-sm font-extrabold text-white transition hover:bg-[#004f9f] focus:outline-none focus:ring-4 focus:ring-[#0072ce]/20 disabled:cursor-not-allowed disabled:bg-[#a5c6c9]"
                    >
                      {continuing
                        ? isArabic ? "جارٍ تجهيز مستنداتك…" : "Preparing your documents…"
                        : hasFailedAnalysis
                          ? isArabic ? "حاول مرة أخرى" : "Try again"
                          : claimJourneyActionLabel(claim.journey, isArabic)}
                    </button>
                  </>
                )}
              </section>
            )}
          </div>

        </section>
      </div>
      {continuing && <ProcessingExperience phase={processingPhase} />}
    </main>
  );
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

function ProgressSteps({ onClaimDetails, isArabic }: { onClaimDetails: () => void; isArabic: boolean }) {
  const steps = isArabic
    ? ["تفاصيل المطالبة", "المستندات", "المراجعة"]
    : ["Claim details", "Documents", "Review"];
  return (
    <ol aria-label={isArabic ? "تقدم المطالبة" : "Claim progress"} className="grid grid-cols-3 gap-1 rounded-2xl border border-[#dce6f0] bg-white p-2 sm:flex sm:items-center sm:gap-0 sm:px-5">
      {steps.map((label, index) => {
        const step = index + 1;
        const complete = step < 2;
        const active = step === 2;
        return (
          <li key={label} aria-current={active ? "step" : undefined} className="flex min-w-0 flex-1 flex-col items-center gap-1 text-center sm:flex-row sm:gap-2 sm:text-start">
            {step === 1 ? (
              <button
                type="button"
                onClick={onClaimDetails}
                className="group flex min-w-0 items-center gap-2 rounded-xl px-1 py-1 text-[#28745f] transition hover:bg-[#eff8f5] focus:outline-none focus:ring-4 focus:ring-[#28745f]/20"
                aria-label={isArabic ? "العودة إلى تفاصيل المطالبة" : "Return to Claim details"}
              >
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#28745f] text-xs font-extrabold text-white shadow-sm transition group-hover:bg-[#236652]">
                  ✓
                </span>
                <span className="w-full text-[10px] font-bold leading-tight underline-offset-4 group-hover:underline sm:w-auto sm:text-sm">
                  {label}
                </span>
              </button>
            ) : (
              <>
                <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-extrabold ${complete ? "bg-[#28745f] text-white" : active ? "bg-[#005eb8] text-white" : "bg-[#f0f4fa] text-[#687a96]"}`}>
                  {complete ? "✓" : step}
                </span>
                <span className={`truncate text-xs font-bold sm:text-sm ${active ? "text-[#0b1e3d]" : "text-[#8a9bbb]"}`}>{label}</span>
              </>
            )}
            {step < steps.length && <span className={`hidden h-px flex-1 sm:block ${step < 2 ? "bg-[#8bc9b7]" : "bg-[#dce6f0]"}`} />}
          </li>
        );
      })}
    </ol>
  );
}

function Checklist({ title, items, subtle = false }: { title: string; items: string[]; subtle?: boolean }) {
  return (
    <div className="mt-5">
      <p className={`text-[11px] font-bold uppercase tracking-[0.12em] ${subtle ? "text-[#8a9bbb]" : "text-[#16715d]"}`}>{title}</p>
      <ul className="mt-3 space-y-3">
        {items.map((item) => (
          <li key={item} className="flex gap-2.5 text-[15px] leading-6 text-[#687a96]">
            <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] ${subtle ? "bg-[#f0f4fa] text-[#687a96]" : "bg-[#dff3ef] text-[#16715d]"}`}>
              {subtle ? "i" : "✓"}
            </span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function FileIcon({ mimeType }: { mimeType: string }) {
  const isPdf = mimeType === "application/pdf";
  return (
    <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl text-xs font-black ${isPdf ? "bg-[#fff0ed] text-[#b84c37]" : "bg-[#eef6fd] text-[#005eb8]"}`}>
      {isPdf ? "PDF" : "IMG"}
    </span>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" className="directional-back-icon h-4 w-4" aria-hidden="true">
      <path d="m14 6-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function UploadIcon({ small = false }: { small?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={small ? "h-4 w-4" : "h-7 w-7"} aria-hidden="true">
      <path d="M12 15V4m0 0L8 8m4-4 4 4M5 14v4.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path d="M4 8.5h3l1.4-2h7.2l1.4 2h3v10H4v-10Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <circle cx="12" cy="13.5" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function DocumentIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-8 w-8" aria-hidden="true">
      <path d="M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M14 3.5V8h4M9 12h6M9 15.5h6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
