import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/auth-context";
import { ApiError } from "../lib/api";
import { useLanguage, type Language } from "../i18n/language-context";
import { BupaMark } from "../components/brand-mark";
import { ThemeToggle } from "../components/theme-toggle";

const PASSWORD_MINIMUM = 8;
type NafathDemoPhase = "request" | "approving" | "verified";

const copy = {
  en: {
    language: "العربية",
    eyebrow: "A simpler reimbursement journey",
    title: "Less paperwork. More clarity.",
    intro:
      "Sahl reads your reimbursement documents, prepares the claim details, and keeps you in control before anything is submitted.",
    featureOne: "Upload Arabic or English documents",
    featureTwo: "Review every extracted detail",
    featureThree: "Fix missing information early",
    welcome: "Welcome to Sahl",
    subtitle: "Sign in to start or continue a reimbursement claim.",
    identifier: "Member or identity number",
    identifierPlaceholder: "Enter your number",
    memberIdDetected: "8-digit Member ID",
    nationalIdDetected: "10-digit National ID",
    iqamaDetected: "10-digit Iqama",
    invalidIdentifierPrefix: "Enter a valid National ID or Iqama.",
    password: "Password",
    passwordPlaceholder: "Enter your password",
    passwordLengthRule: "8+ characters",
    passwordUppercaseRule: "Uppercase letter",
    passwordLowercaseRule: "Lowercase letter",
    passwordNumberRule: "Number",
    passwordSpecialCharacterRule: "Special character",
    passwordStrength: "Password strength",
    strengthWeak: "Weak",
    strengthFair: "Fair",
    strengthGood: "Good",
    strengthStrong: "Strong",
    showPassword: "Show password",
    hidePassword: "Hide password",
    submit: "Sign in",
    submitting: "Signing in…",
    nafathButton: "Sign in with Nafath",
    nafathDemo: "Demo",
    nafathTitle: "Nafath Demo Request",
    nafathIntro: "Open Nafath and approve this request.",
    nafathRequestNumber: "Request number",
    nafathApprove: "Simulate approval",
    nafathApproving: "Checking demo approval…",
    nafathVerified: "Identity verified",
    nafathDisclaimer: "Prototype simulation only — no connection to the real Nafath service.",
    orMemberLogin: "or use demo member sign-in",
    firstVisit: "First time here?",
    accountNote:
      "Your profile is created automatically on first sign-in.",
    idError:
      "Enter an 8-digit Member ID or a 10-digit National ID or Iqama.",
    passwordError: "Password must contain at least 8 characters.",
    passwordTooShort:
      "Password must contain at least 8 characters.",
    passwordTooLong: "Use a password of no more than 72 characters.",
    passwordMissingUppercase:
      "Add at least one uppercase letter to your password.",
    passwordMissingLowercase:
      "Add at least one lowercase letter to your password.",
    passwordMissingNumber: "Add at least one number to your password.",
    passwordMissingSpecialCharacter:
      "Add at least one special character to your password."
  },
  ar: {
    language: "English",
    eyebrow: "رحلة تعويضات أبسط",
    title: "مستندات أقل. وضوح أكثر.",
    intro:
      "يقرأ سهل مستندات التعويض، ويجهّز بيانات المطالبة، ويتيح لك مراجعتها قبل الإرسال.",
    featureOne: "ارفع مستندات عربية أو إنجليزية",
    featureTwo: "راجع كل البيانات المستخرجة",
    featureThree: "اكتشف المعلومات الناقصة مبكراً",
    welcome: "مرحباً بك في سهل",
    subtitle: "سجّل الدخول لبدء مطالبة تعويض أو متابعة مطالبة سابقة.",
    identifier: "رقم العضوية أو رقم الهوية",
    identifierPlaceholder: "أدخل رقمك",
    memberIdDetected: "رقم عضوية من 8 أرقام",
    nationalIdDetected: "هوية وطنية من 10 أرقام",
    iqamaDetected: "إقامة من 10 أرقام",
    invalidIdentifierPrefix: "أدخل رقم هوية وطنية أو إقامة صالحاً.",
    password: "كلمة المرور",
    passwordPlaceholder: "أدخل كلمة المرور",
    passwordLengthRule: "8 أحرف أو أكثر",
    passwordUppercaseRule: "حرف كبير",
    passwordLowercaseRule: "حرف صغير",
    passwordNumberRule: "رقم",
    passwordSpecialCharacterRule: "رمز خاص",
    passwordStrength: "قوة كلمة المرور",
    strengthWeak: "ضعيفة",
    strengthFair: "مقبولة",
    strengthGood: "جيدة",
    strengthStrong: "قوية",
    showPassword: "إظهار كلمة المرور",
    hidePassword: "إخفاء كلمة المرور",
    submit: "تسجيل الدخول",
    submitting: "جارٍ تسجيل الدخول…",
    nafathButton: "تسجيل الدخول عبر نفاذ",
    nafathDemo: "تجريبي",
    nafathTitle: "طلب نفاذ تجريبي",
    nafathIntro: "افتح تطبيق نفاذ ووافق على هذا الطلب.",
    nafathRequestNumber: "رقم الطلب",
    nafathApprove: "محاكاة الموافقة",
    nafathApproving: "جارٍ التحقق من الموافقة التجريبية…",
    nafathVerified: "تم التحقق من الهوية",
    nafathDisclaimer: "محاكاة لنموذج أولي فقط — لا يوجد اتصال بخدمة نفاذ الحقيقية.",
    orMemberLogin: "أو استخدم دخول العضو التجريبي",
    firstVisit: "هل هذه زيارتك الأولى؟",
    accountNote:
      "سيُنشأ ملفك تلقائياً عند تسجيل الدخول لأول مرة. استخدم بيانات تجريبية فقط.",
    idError:
      "أدخل رقم عضوية من 8 أرقام أو رقم هوية وطنية أو إقامة من 10 أرقام.",
    passwordError: "يجب أن تتكون كلمة المرور من 8 أحرف على الأقل.",
    passwordTooShort:
      "يجب أن تحتوي كلمة المرور على 8 أحرف على الأقل.",
    passwordTooLong: "استخدم كلمة مرور لا تتجاوز 72 حرفاً.",
    passwordMissingUppercase:
      "أضف حرفاً كبيراً واحداً على الأقل إلى كلمة المرور.",
    passwordMissingLowercase:
      "أضف حرفاً صغيراً واحداً على الأقل إلى كلمة المرور.",
    passwordMissingNumber: "أضف رقماً واحداً على الأقل إلى كلمة المرور.",
    passwordMissingSpecialCharacter:
      "أضف رمزاً خاصاً واحداً على الأقل إلى كلمة المرور."
  }
} satisfies Record<Language, Record<string, string>>;

interface LocationState {
  from?: { pathname?: string };
}

export function LoginPage() {
  const { language, setLanguage } = useLanguage();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [nafathPhase, setNafathPhase] = useState<NafathDemoPhase | null>(null);
  const [nafathRequestNumber, setNafathRequestNumber] = useState(47);
  const nafathDemoCredentials = useRef<{ identifier: string; password: string } | null>(null);
  const [error, setError] = useState("");
  const { login, member, loading, sessionExpired } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const text = copy[language];
  const isArabic = language === "ar";
  const identifierHint =
    /^\d{8}$/.test(identifier)
      ? text.memberIdDetected
      : /^1\d{9}$/.test(identifier)
        ? text.nationalIdDetected
        : /^2\d{9}$/.test(identifier)
          ? text.iqamaDetected
          : identifier.length === 10
            ? text.invalidIdentifierPrefix
            : null;
  const passwordIsLongEnough =
    password.length >= PASSWORD_MINIMUM;
  const passwordHasUppercase = /[A-Z]/.test(password);
  const passwordHasLowercase = /[a-z]/.test(password);
  const passwordHasNumber = /\d/.test(password);
  const passwordHasSpecialCharacter = /[^\p{L}\p{N}\s]/u.test(password);
  const passwordStrength = getPasswordStrength(
    password,
    passwordIsLongEnough,
    passwordHasUppercase,
    passwordHasLowercase,
    passwordHasNumber,
    passwordHasSpecialCharacter
  );

  const destination = useMemo(() => {
    const state = location.state as LocationState | null;
    return state?.from?.pathname ?? "/claims";
  }, [location.state]);

  useEffect(() => {
    if (!loading && member && nafathPhase === null) {
      navigate("/claims", { replace: true });
    }
  }, [loading, member, nafathPhase, navigate]);

  function openNafathDemo() {
    setError("");
    setNafathRequestNumber(Math.floor(10 + Math.random() * 90));
    nafathDemoCredentials.current = createNafathDemoCredentials();
    setNafathPhase("request");
  }

  async function approveNafathDemo() {
    setError("");
    setNafathPhase("approving");
    await new Promise((resolve) => window.setTimeout(resolve, 900));
    try {
      const credentials = nafathDemoCredentials.current ?? createNafathDemoCredentials();
      const result = await login(credentials.identifier, credentials.password);
      setNafathPhase("verified");
      await new Promise((resolve) => window.setTimeout(resolve, 650));
      navigate(destination, {
        replace: true,
        state: { accountCreated: result.created }
      });
    } catch (caught) {
      setNafathPhase("request");
      setError(caught instanceof Error ? caught.message : "We could not complete the demo sign-in.");
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!/^(?:\d{8}|1\d{9}|2\d{9})$/.test(identifier)) {
      setError(
        identifier.length === 10
          ? text.invalidIdentifierPrefix
          : text.idError
      );
      return;
    }

    if (password.length < 8) {
      setError(text.passwordError);
      return;
    }

    setSubmitting(true);
    try {
      const result = await login(identifier, password);
      navigate(destination, {
        replace: true,
        state: { accountCreated: result.created }
      });
    } catch (caught) {
      if (caught instanceof ApiError) {
        const policyMessage = {
          PASSWORD_TOO_SHORT: text.passwordTooShort,
          PASSWORD_TOO_LONG: text.passwordTooLong,
          PASSWORD_MISSING_UPPERCASE: text.passwordMissingUppercase,
          PASSWORD_MISSING_LOWERCASE: text.passwordMissingLowercase,
          PASSWORD_MISSING_NUMBER: text.passwordMissingNumber,
          PASSWORD_MISSING_SPECIAL_CHARACTER:
            text.passwordMissingSpecialCharacter
        }[caught.code ?? ""];
        setError(policyMessage ?? caught.message);
      } else {
        setError(
          caught instanceof Error
            ? caught.message
            : "We could not sign you in. Please try again."
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main
      className="sahl-login min-h-screen bg-[#f4f7fb] text-[#0b1e3d]"
      dir={isArabic ? "rtl" : "ltr"}
      lang={isArabic ? "ar-SA" : "en"}
    >
      <div className="login-shell grid min-h-screen lg:grid-cols-[0.9fr_1.1fr]">
        <section className="hero-panel relative hidden overflow-hidden px-12 py-10 text-white lg:flex lg:flex-col">
          <div className="hero-glow hero-glow-one" />
          <div className="hero-glow hero-glow-two" />

          <div className="relative z-10 my-auto max-w-xl">
            <p className="mb-5 text-xs font-bold uppercase tracking-[0.24em] text-[#9cd5f9] animate-fade-in-up stagger-1">
              {text.eyebrow}
            </p>
            <h1 className="max-w-lg text-5xl font-bold leading-[1.08] tracking-[-0.04em] xl:text-6xl animate-fade-in-up stagger-2">
              {text.title}
            </h1>
            <p className="mt-6 max-w-lg text-base leading-7 text-white/75 animate-fade-in-up stagger-3">
              {text.intro}
            </p>

            <div className="mt-10 grid gap-4 text-sm text-white/90 animate-fade-in-up stagger-4">
              {[text.featureOne, text.featureTwo, text.featureThree].map(
                (feature) => (
                  <div key={feature} className="feature-item flex items-center gap-3 cursor-default">
                    <span className="feature-icon grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/15">
                      <CheckIcon />
                    </span>
                    <span>{feature}</span>
                  </div>
                )
              )}
            </div>
          </div>

          <p className="relative z-10 text-xs text-white/55 animate-fade-in-up stagger-5">
            Sahl · Bupa Arabia internship prototype
          </p>
        </section>

        <section className="relative flex min-h-[100dvh] items-center justify-center px-5 py-20 sm:min-h-screen sm:px-10 sm:py-8 lg:px-16">
          <div className="login-utilities absolute end-5 top-5 z-20 flex items-center gap-2 sm:end-10 sm:top-8">
            <ThemeToggle darkSurface />
            <button
              type="button"
              onClick={() => setLanguage(isArabic ? "en" : "ar")}
              className="btn-lang rounded-full border border-[#dce6f0] bg-white/80 px-4 py-2 text-sm font-bold text-[#005eb8] shadow-sm backdrop-blur"
            >
              {text.language}
            </button>
          </div>

          <div className="w-full max-w-[470px]">
            <div className="mb-7 flex justify-center animate-fade-in-up">
              <span className="logo-float block h-20 w-20 overflow-hidden rounded-[22px] shadow-[0_12px_32px_rgba(3,35,83,0.3)]">
                <BupaMark />
              </span>
            </div>

            <div className="card-login rounded-[28px] border border-white/80 bg-white p-6 shadow-[0_24px_70px_rgba(28,78,91,0.12)] sm:p-9">
              <div className="mb-8 animate-fade-in-up stagger-1">
                <h2 className="text-2xl font-semibold tracking-[-0.02em] text-[#0A2240]">
                  {text.welcome}
                </h2>
                <p className="mt-2 text-sm leading-6 text-[#4B5E76]">
                  {text.subtitle}
                </p>
              </div>

              <form onSubmit={handleSubmit} noValidate>
                {sessionExpired && !error && (
                  <div
                    role="status"
                    className="mb-5 rounded-xl border border-[#dce6f0] bg-[#eef6fd] px-4 py-3 text-sm text-[#0b1e3d]"
                  >
                    {isArabic
                      ? "انتهت جلستك. سجّل الدخول مرة أخرى للمتابعة من حيث توقفت."
                      : "Your session ended. Sign in again to continue where you left off."}
                  </div>
                )}
                <div className="space-y-5 animate-fade-in-up stagger-2">
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-[#425979]">
                      {text.identifier}
                    </span>
                    <div className="input-shell flex items-center gap-3 rounded-xl border border-[#dce6f0] bg-[#f7fafd] px-4 transition focus-within:border-[#005eb8] focus-within:bg-white focus-within:ring-4 focus-within:ring-[#005eb8]/10">
                      <MemberIcon />
                      <input
                        value={identifier}
                        onChange={(event) =>
                          setIdentifier(
                            event.target.value.replace(/\D/g, "")
                          )
                        }
                        inputMode="numeric"
                        autoComplete="username"
                        maxLength={10}
                        placeholder={text.identifierPlaceholder}
                        className="h-13 min-w-0 flex-1 bg-transparent py-3.5 text-start text-sm text-[#0A2240] outline-none placeholder:text-[#8a9bbb]"
                        dir="ltr"
                        aria-invalid={Boolean(error)}
                      />
                    </div>
                    {identifierHint && <span className="mt-2 block text-xs text-[#687a96]">{identifierHint}</span>}
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-[#425979]">
                      {text.password}
                    </span>
                    <div className="input-shell flex items-center gap-3 rounded-xl border border-[#dce6f0] bg-[#f7fafd] px-4 transition focus-within:border-[#005eb8] focus-within:bg-white focus-within:ring-4 focus-within:ring-[#005eb8]/10">
                      <LockIcon />
                      <input
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        type={showPassword ? "text" : "password"}
                        autoComplete="current-password"
                        maxLength={72}
                        placeholder={text.passwordPlaceholder}
                        className="h-13 min-w-0 flex-1 bg-transparent py-3.5 text-start text-sm text-[#0A2240] outline-none placeholder:text-[#8a9bbb]"
                        dir="ltr"
                        aria-invalid={Boolean(error)}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((visible) => !visible)}
                        className="btn-eye rounded-md p-1 text-[#4B5E76] hover:bg-[#eef6fd] hover:text-[#005eb8]"
                        aria-label={
                          showPassword ? text.hidePassword : text.showPassword
                        }
                      >
                        {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                      </button>
                    </div>
                    {password && (
                      <div className="mt-3 rounded-xl border border-[#dce6f0] bg-[#f7fafd] px-3.5 py-3">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-[#687a96]">
                            {text.passwordStrength}
                          </span>
                          <span
                            className={`font-extrabold ${
                              passwordStrength.labelKey === "strengthStrong"
                                ? "text-[#2f8068]"
                                : passwordStrength.labelKey === "strengthGood"
                                  ? "text-[#005eb8]"
                                  : passwordStrength.labelKey === "strengthFair"
                                    ? "text-[#a27427]"
                                    : "text-[#ad5a50]"
                            }`}
                          >
                            {
                              text[passwordStrength.labelKey]
                            }
                          </span>
                        </div>
                        <div
                          className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#dce6f0]"
                          role="progressbar"
                          aria-label={text.passwordStrength}
                          aria-valuemin={0}
                          aria-valuemax={4}
                          aria-valuenow={passwordStrength.level}
                          aria-valuetext={text[passwordStrength.labelKey]}
                        >
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${
                              passwordStrength.labelKey === "strengthStrong"
                                ? "bg-[#3d9a7f]"
                                : passwordStrength.labelKey === "strengthGood"
                                  ? "bg-[#005eb8]"
                                  : passwordStrength.labelKey === "strengthFair"
                                    ? "bg-[#d4a547]"
                                    : "bg-[#d47a6f]"
                            }`}
                            style={{
                              width: `${passwordStrength.level * 25}%`
                            }}
                          />
                        </div>

                        <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 min-[380px]:grid-cols-2">
                          <PasswordRule
                            satisfied={passwordIsLongEnough}
                            label={text.passwordLengthRule}
                          />
                          <PasswordRule
                            satisfied={passwordHasUppercase}
                            label={text.passwordUppercaseRule}
                          />
                          <PasswordRule
                            satisfied={passwordHasLowercase}
                            label={text.passwordLowercaseRule}
                          />
                          <PasswordRule
                            satisfied={passwordHasNumber}
                            label={text.passwordNumberRule}
                          />
                          <PasswordRule
                            satisfied={passwordHasSpecialCharacter}
                            label={text.passwordSpecialCharacterRule}
                          />
                        </div>
                      </div>
                    )}
                  </label>
                </div>

                {error && (
                  <div
                    role="alert"
                    className="mt-5 rounded-xl border border-[#f1c7c2] bg-[#fff4f2] px-4 py-3 text-sm text-[#a13c32] animate-fade-in-up stagger-3"
                  >
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="btn-primary mt-6 flex h-13 w-full items-center justify-center gap-2 rounded-xl bg-[#005eb8] px-5 py-3.5 text-sm font-extrabold text-white shadow-lg shadow-[#005eb8]/20 focus:outline-none focus:ring-4 focus:ring-[#0072ce]/20 disabled:cursor-not-allowed disabled:opacity-60 animate-fade-in-up stagger-3"
                >
                  {submitting && (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/35 border-t-white" />
                  )}
                  {submitting ? text.submitting : text.submit}
                </button>


              </form>

              <div className="info-box mt-6 rounded-xl bg-[#eef6fd] px-4 py-3.5 animate-fade-in-up stagger-4">
                 <p className="text-xs font-semibold text-[#1B3B5A]">
                  {text.firstVisit}
                </p>
                <p className="mt-1 text-xs leading-5 text-[#4B5E76]">
                  {text.accountNote}
                </p>
              </div>
            </div>

          </div>
        </section>
      </div>

      {nafathPhase && (
        <div className="nafath-demo-modal fixed inset-0 z-50 grid place-items-center bg-[#071a34]/55 px-4 py-8 backdrop-blur-sm" role="presentation">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="nafath-demo-title"
            className="nafath-demo-dialog w-full max-w-sm rounded-[26px] border p-6 text-center shadow-[0_30px_90px_rgba(3,35,83,0.35)] sm:p-7"
          >
            <div className={`mx-auto grid h-14 w-14 place-items-center rounded-2xl ${nafathPhase === "verified" ? "bg-[#e6f6f0] text-[#28745f]" : "bg-[#eef6fd] text-[#005eb8]"}`}>
              {nafathPhase === "approving" ? <span className="h-6 w-6 animate-spin rounded-full border-2 border-current/25 border-t-current" aria-hidden="true" /> : nafathPhase === "verified" ? <CheckIcon /> : <NafathShieldIcon />}
            </div>
            <div className="mt-4 flex items-center justify-center gap-2">
              <h2 id="nafath-demo-title" className="nafath-demo-title text-lg font-extrabold">{text.nafathTitle}</h2>
              <span className="rounded-full bg-[#005eb8] px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-white">{text.nafathDemo}</span>
            </div>
            {nafathPhase === "verified" ? (
              <p className="mt-5 text-base font-extrabold text-[#28745f]" role="status">{text.nafathVerified}</p>
            ) : (
              <>
                <p className="nafath-demo-intro mt-2 text-sm leading-6">{text.nafathIntro}</p>
                <div className="nafath-demo-request mx-auto mt-5 w-fit rounded-2xl border px-7 py-4">
                  <p className="nafath-demo-request-label text-[10px] font-bold uppercase tracking-[0.12em]">{text.nafathRequestNumber}</p>
                  <p className="nafath-demo-request-number mt-1 text-4xl font-black tracking-tight" dir="ltr">{nafathRequestNumber}</p>
                </div>
              </>
            )}
            <p className="nafath-demo-disclaimer mt-5 text-[11px] leading-5">{text.nafathDisclaimer}</p>
            {error && <p role="alert" className="mt-3 rounded-xl border border-[#f1c7c2] bg-[#fff4f2] px-3 py-2 text-xs text-[#a13c32]">{error}</p>}
            {nafathPhase !== "verified" && (
              <div className="mt-6 grid gap-2 sm:grid-cols-2">
                <button type="button" onClick={() => setNafathPhase(null)} disabled={nafathPhase === "approving"} className="nafath-demo-cancel rounded-xl border px-4 py-3 text-sm font-bold disabled:opacity-50">{isArabic ? "إلغاء" : "Cancel"}</button>
                <button type="button" onClick={() => void approveNafathDemo()} disabled={nafathPhase === "approving"} className="rounded-xl bg-[#005eb8] px-4 py-3 text-sm font-extrabold text-white shadow-md shadow-[#005eb8]/15 disabled:opacity-65">{nafathPhase === "approving" ? text.nafathApproving : text.nafathApprove}</button>
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

function createNafathDemoCredentials() {
  const memberSuffix = Math.floor(100000 + Math.random() * 900000);
  const passwordSuffix = Math.floor(100000 + Math.random() * 900000);
  return {
    identifier: `66${memberSuffix}`,
    password: `SahlDemo!${passwordSuffix}Aa`
  };
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" aria-hidden="true">
      <path
        d="m5 10.2 3.1 3.1L15.5 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function NafathShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
      <path d="M12 3.5 19 6v5.2c0 4.3-2.6 7.7-7 9.3-4.4-1.6-7-5-7-9.3V6l7-2.5Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="m8.8 12 2 2 4.4-4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PasswordRule({
  satisfied,
  label
}: {
  satisfied: boolean;
  label: string;
}) {
  return (
    <div
      className={`flex items-center gap-2 text-xs ${
        satisfied ? "text-[#397765]" : "text-[#687a96]"
      }`}
    >
      <span
        className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border text-[10px] ${
          satisfied
            ? "border-[#7fc1ac] bg-[#e9f6f1] font-black text-[#2f8068]"
            : "border-[#dce6f0] bg-white text-transparent"
        }`}
        aria-hidden="true"
      >
        ✓
      </span>
      <span>{label}</span>
    </div>
  );
}

function getPasswordStrength(
  password: string,
  isLongEnough: boolean,
  hasUppercase: boolean,
  hasLowercase: boolean,
  hasNumber: boolean,
  hasSpecialCharacter: boolean
): {
  level: 1 | 2 | 3 | 4;
  labelKey: "strengthWeak" | "strengthFair" | "strengthGood" | "strengthStrong";
} {
  const meetsRequirements = [
    isLongEnough,
    hasUppercase,
    hasLowercase,
    hasNumber,
    hasSpecialCharacter
  ].every(Boolean);

  if (!meetsRequirements) return { level: 1, labelKey: "strengthWeak" };
  if (password.length >= 16) return { level: 4, labelKey: "strengthStrong" };
  if (password.length >= 12) return { level: 3, labelKey: "strengthGood" };
  return { level: 2, labelKey: "strengthFair" };
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
      <path
        d="M12 3 5.5 5.6v5.7c0 4 2.6 7.7 6.5 9.7 3.9-2 6.5-5.7 6.5-9.7V5.6L12 3Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="m9 12 2 2 4-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MemberIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5 shrink-0 text-[#517599]"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="8"
        r="3.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M5.5 19c.7-3.3 3.1-5.2 6.5-5.2s5.8 1.9 6.5 5.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5 shrink-0 text-[#517599]"
      aria-hidden="true"
    >
      <rect
        x="5.5"
        y="10"
        width="13"
        height="10"
        rx="2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path
        d="M3.5 12s3-5 8.5-5 8.5 5 8.5 5-3 5-8.5 5-8.5-5-8.5-5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <circle
        cx="12"
        cy="12"
        r="2.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path
        d="m4 4 16 16M9.8 7.3A9 9 0 0 1 12 7c5.5 0 8.5 5 8.5 5a12 12 0 0 1-2.1 2.7M14.2 16.7A9 9 0 0 1 12 17c-5.5 0-8.5-5-8.5-5a12 12 0 0 1 2.1-2.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}
