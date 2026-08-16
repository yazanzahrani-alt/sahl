import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { opsApi } from "../lib/api";
import { useLanguage } from "../i18n/language-context";
import { LanguageToggle } from "./language-toggle";
import { useAuth } from "../auth/auth-context";
import { ThemeToggle } from "./theme-toggle";

export function HeaderUtilities({ dark = false }: { dark?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <ThemeToggle darkSurface={dark} />
      <LanguageToggle dark={dark} />
    </div>
  );
}

export function PresenterTools() {
  const location = useLocation();
  const [enabled, setEnabled] = useState(false);
  const { isArabic } = useLanguage();
  const { member } = useAuth();

  useEffect(() => {
    void opsApi.status()
      .then((status) => setEnabled(status.enabled))
      .catch(() => setEnabled(false));
  }, []);

  if (!enabled || !member || location.pathname.startsWith("/ops")) return null;

  return (
    <button
      type="button"
      onClick={() => window.open("/ops", "_blank", "noopener,noreferrer")}
      className="demo-ops-launcher fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] end-3 z-40 flex h-9 items-center gap-1.5 rounded-lg border border-[#c9dcec] bg-white/95 px-2.5 text-start shadow-[0_8px_22px_rgba(11,30,61,0.13)] backdrop-blur transition hover:border-[#82b2db] hover:bg-[#f7fafd] focus:outline-none focus:ring-4 focus:ring-[#0072ce]/20"
      aria-label={isArabic ? "فتح واجهة عمليات المعالجة التجريبية" : "Open the demo processing Ops view"}
    >
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-[#eef6fd] text-[#005eb8]">
        <OpsIcon />
      </span>
      <span className="whitespace-nowrap text-[11px] font-bold text-[#425979]">{isArabic ? "أدوات العرض" : "Dev Tools"}</span>
    </button>
  );
}

function OpsIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path d="M4.5 5.5h15v13h-15zM8 9h8m-8 3h5m-5 3h7" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
