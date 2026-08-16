import { useLanguage } from "../i18n/language-context";
import { useTheme } from "../theme/theme-context";

export function ThemeToggle({ darkSurface = false }: { darkSurface?: boolean }) {
  const { theme, toggleTheme } = useTheme();
  const { isArabic } = useLanguage();
  const isDark = theme === "dark";
  const label = isDark
    ? isArabic ? "التبديل إلى الوضع النهاري" : "Switch to light mode"
    : isArabic ? "التبديل إلى الوضع الليلي" : "Switch to dark mode";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={`theme-toggle grid h-10 w-10 shrink-0 place-items-center rounded-xl border transition focus:outline-none focus:ring-4 ${
        darkSurface
          ? "border-white/20 bg-white/5 text-white hover:bg-white/10 focus:ring-white/10"
          : "border-[#c9dcec] bg-white text-[#005eb8] hover:border-[#82b2db] hover:bg-[#eef6fd] focus:ring-[#0072ce]/20"
      }`}
      aria-label={label}
      title={label}
      aria-pressed={isDark}
    >
      {isDark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" aria-hidden="true">
      <circle cx="12" cy="12" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" aria-hidden="true">
      <path d="M19.3 15.4A8 8 0 0 1 8.6 4.7 8 8 0 1 0 19.3 15.4Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
