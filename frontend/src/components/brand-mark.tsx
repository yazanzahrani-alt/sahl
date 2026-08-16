import { useLanguage } from "../i18n/language-context";
import bupaLogo from "../assets/bupa-arabia-icon.png";

export function BupaMark({ className = "h-full w-full" }: { className?: string }) {
  return (
    <span className={`bupa-mark relative block overflow-hidden rounded-[inherit] ${className}`}>
      <img src={bupaLogo} alt="Bupa Arabia" className="block h-full w-full object-cover" />
      <svg
        aria-hidden="true"
        className="bupa-mark__pulse pointer-events-none absolute inset-0 h-full w-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        <path
          className="bupa-mark__pulse-path"
          pathLength="100"
          d="M37.4 68.6H61.5c4.4 0 7.1-1.8 9.8-5.6l3.6 5.8 8.2-28.7 4.7 38.2 6.1-13.3 3.2 3.6H100"
        />
      </svg>
    </span>
  );
}

export function SahlBrand({ light = false, compact = false }: { light?: boolean; compact?: boolean }) {
  const { isArabic } = useLanguage();
  return (
    <div className="flex items-center gap-3">
      <span className={`${compact ? "h-10 w-10" : "h-11 w-11"} shrink-0 overflow-hidden rounded-xl shadow-sm`}>
        <BupaMark />
      </span>
      <span className="min-w-0">
        <span className={`block font-black tracking-[-0.025em] ${light ? "text-white" : "text-[#0B1E3D]"}`}>Sahl</span>
        <span className={`hidden text-[10px] font-semibold sm:block ${light ? "text-white/60" : "text-[#8A9BBB]"}`}>{isArabic ? "مطالبات التعويض" : "Reimbursement claims"}</span>
      </span>
    </div>
  );
}
