import { useEffect, useRef, useState } from "react";
import { claimsApi, localizedApiError } from "../lib/api";
import { useLanguage } from "../i18n/language-context";

export function DiscardDraftButton({
  claimId,
  onDiscarded,
  compact = false,
  menu = false
}: {
  claimId: string;
  onDiscarded: () => void;
  compact?: boolean;
  menu?: boolean;
}) {
  const { isArabic } = useLanguage();
  const [confirming, setConfirming] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen && !confirming) return;
    function closeMenu(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node) && !discarding) {
        setMenuOpen(false);
        setConfirming(false);
        setError(null);
      }
    }
    document.addEventListener("mousedown", closeMenu);
    return () => document.removeEventListener("mousedown", closeMenu);
  }, [menuOpen, confirming, discarding]);

  async function discard() {
    setDiscarding(true);
    setError(null);
    try {
      await claimsApi.discard(claimId);
      onDiscarded();
    } catch (requestError) {
      setError(localizedApiError(requestError, isArabic, "تعذر حذف المسودة. حاول مرة أخرى.", "We could not discard this draft. Please try again."));
      setDiscarding(false);
    }
  }

  return (
    <div className="relative" ref={menuRef}>
      {menu ? (
        <>
          <button type="button" onClick={() => setMenuOpen((open) => !open)} aria-expanded={menuOpen} aria-label={isArabic ? "خيارات المطالبة" : "Claim options"} className="grid h-8 w-8 place-items-center rounded-full text-lg font-semibold leading-none text-[#8a9bbb] transition hover:bg-[#f0f4fa] hover:text-[#425979]">•••</button>
          {menuOpen && (
            <div className="absolute end-0 top-full z-30 mt-1 w-40 rounded-xl border border-[#dce6f0] bg-white p-1.5 shadow-[0_12px_30px_rgba(11,30,61,0.16)]">
              <button type="button" onClick={() => { setMenuOpen(false); setError(null); setConfirming(true); }} className="w-full rounded-lg px-3 py-2 text-start text-xs font-semibold text-[#a34a3b] transition hover:bg-[#fff3f1]">{isArabic ? "حذف المسودة" : "Discard draft"}</button>
            </div>
          )}
        </>
      ) : (
        <button
          type="button"
          onClick={() => {
            setError(null);
            setConfirming(true);
          }}
          className={compact
            ? "discard-draft-trigger rounded-lg px-2.5 py-2 text-xs font-semibold text-[#8a9bbb] transition hover:bg-[#f7fafd] hover:text-[#a34a3b]"
            : "rounded-xl border border-[#e5c3bc] bg-white px-3 py-2 text-xs font-bold text-[#a34a3b] transition hover:border-[#d89589] hover:bg-[#fff6f4]"}
        >
          {compact ? (isArabic ? "حذف" : "Discard") : (isArabic ? "حذف المسودة" : "Discard draft")}
        </button>
      )}

      {confirming && (
        <section
          role="dialog"
          aria-labelledby={`discard-${claimId}-title`}
          aria-describedby={`discard-${claimId}-description`}
          className="absolute end-0 top-full z-40 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-[#dce6f0] bg-white p-4 text-start shadow-[0_12px_30px_rgba(11,30,61,0.16)]"
        >
          <div className="flex items-start gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#fff0ed] text-[#b14e3d]">
              <TrashIcon />
            </div>
            <div>
              <h2 id={`discard-${claimId}-title`} className="text-sm font-bold text-[#0b1e3d]">
                {isArabic ? "حذف هذه المسودة؟" : "Discard this draft?"}
              </h2>
              <p id={`discard-${claimId}-description`} className="mt-1 text-xs leading-5 text-[#687a96]">
                {isArabic
                  ? "سيتم حذف المستندات والمعلومات المجهزة نهائياً."
                  : "Uploaded documents and prepared information will be permanently removed."}
              </p>
            </div>
          </div>
          {error && (
            <p className="mt-3 rounded-lg border border-[#f1c7bd] bg-[#fff4f1] px-3 py-2 text-xs font-medium text-[#a04432]">
              {error}
            </p>
          )}
          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={discarding}
              className="rounded-lg px-3 py-2 text-xs font-bold text-[#425979] transition hover:bg-[#f7fafd] disabled:opacity-60"
            >
              {isArabic ? "احتفاظ" : "Keep"}
            </button>
            <button
              type="button"
              onClick={() => void discard()}
              disabled={discarding}
              className="rounded-lg bg-[#b14e3d] px-3 py-2 text-xs font-bold text-white transition hover:bg-[#963f31] disabled:cursor-wait disabled:opacity-60"
            >
              {discarding
                ? isArabic ? "جارٍ الحذف…" : "Discarding…"
                : isArabic ? "حذف المسودة" : "Discard draft"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path d="M5 7h14M9 7V4.5h6V7m-8 0 .7 13h8.6L17 7M10 11v5m4-5v5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
