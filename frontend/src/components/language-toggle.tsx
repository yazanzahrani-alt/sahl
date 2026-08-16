import { useLanguage } from "../i18n/language-context";

export function LanguageToggle({ dark = false }: { dark?: boolean }) {
  const { isArabic, toggleLanguage } = useLanguage();

  return (
    <button
      type="button"
      onClick={toggleLanguage}
      className={dark
        ? "rounded-xl border border-white/20 bg-white/5 px-3 py-2.5 text-xs font-extrabold text-white transition hover:bg-white/10 focus:outline-none focus:ring-4 focus:ring-white/10"
        : "rounded-xl border border-[#c9dcec] bg-white px-3 py-2.5 text-xs font-extrabold text-[#005eb8] transition hover:border-[#82b2db] hover:bg-[#eef6fd] focus:outline-none focus:ring-4 focus:ring-[#0072ce]/20"}
      aria-label={isArabic ? "التبديل إلى الإنجليزية" : "Switch to Arabic"}
    >
      {isArabic ? "English" : "العربية"}
    </button>
  );
}
