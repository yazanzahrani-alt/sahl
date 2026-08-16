import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";

/**
 * Shared interaction primitives.
 *
 * Every interactive surface in the app should come from here so that weight,
 * padding, radius, focus ring, disabled treatment and transition stay in step.
 * Page-specific one-offs (status pills, category tiles) still live in their own
 * files, but anything that reads as "a button" belongs in this file.
 */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-xl font-bold transition focus:outline-none focus:ring-4 disabled:cursor-not-allowed";

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "px-4 py-2.5 text-xs",
  md: "px-5 py-3 text-sm",
  lg: "px-6 py-3.5 text-sm"
};

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-[#005eb8] text-white hover:bg-[#004f9f] focus:ring-[#0072ce]/20 disabled:bg-[#d8e1ec] disabled:text-[#7e8fa9]",
  secondary:
    "border border-[#c9dcec] bg-white text-[#425979] hover:border-[#82b2db] hover:bg-[#f7fafd] focus:ring-[#0072ce]/15 disabled:opacity-60",
  ghost:
    "text-[#425979] hover:bg-[#f7fafd] focus:ring-[#0072ce]/10 disabled:opacity-60",
  danger:
    "border border-[#f1c7bd] bg-white text-[#a04432] hover:bg-[#fff4f1] focus:ring-[#b84c37]/15 disabled:opacity-60"
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  fullWidth = false,
  className = "",
  disabled,
  children,
  ...props
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  children: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={`${BUTTON_BASE} ${BUTTON_SIZES[size]} ${BUTTON_VARIANTS[variant]} ${
        fullWidth ? "w-full" : ""
      } ${className}`}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`${className} shrink-0 animate-spin rounded-full border-2 border-current/30 border-t-current`}
    />
  );
}

type PageStateTone = "loading" | "error" | "empty";

const PAGE_STATE_TONES: Record<PageStateTone, string> = {
  loading: "bg-[#eef6fd] text-[#005eb8]",
  error: "bg-[#fff2ef] text-[#b84c37]",
  empty: "bg-[#eef6fd] text-[#005eb8]"
};

/**
 * The single full-page loading / error / empty treatment. Replaces the five
 * different ad-hoc versions the pages each used to carry.
 */
export function PageState({
  tone = "loading",
  title,
  description,
  icon,
  actionLabel,
  onAction,
  inline = false
}: {
  tone?: PageStateTone;
  title: string;
  description?: string;
  icon?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  inline?: boolean;
}) {
  const body = (
    <div className="max-w-md text-center">
      <div
        className={`mx-auto grid h-16 w-16 place-items-center rounded-2xl ${PAGE_STATE_TONES[tone]}`}
      >
        {icon ?? (tone === "loading" ? <Spinner className="h-7 w-7" /> : <StateIcon tone={tone} />)}
      </div>
      <h2 className="mt-5 text-lg font-extrabold text-[#0b1e3d]">{title}</h2>
      {description && (
        <p className="mt-2 text-sm leading-6 text-[#687a96]">{description}</p>
      )}
      {actionLabel && onAction && (
        <Button variant="primary" size="md" onClick={onAction} className="mt-5">
          {actionLabel}
        </Button>
      )}
    </div>
  );

  if (inline) {
    return <div className="grid min-h-[300px] place-items-center px-6 py-12">{body}</div>;
  }

  return (
    <main className="sahl-app grid min-h-screen place-items-center bg-[#f4f7fb] px-5 text-[#0b1e3d]">
      <div className="w-full max-w-md rounded-[24px] border border-[#dce6f0] bg-white px-7 py-10 shadow-[0_12px_35px_rgba(38,79,89,0.06)]">
        {body}
      </div>
    </main>
  );
}

/** Avoids flashing a large loading card for requests that resolve immediately. */
export function DelayedPageState({
  delayMs = 380,
  ...props
}: Omit<Parameters<typeof PageState>[0], "tone"> & { delayMs?: number }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs]);

  if (!visible) {
    if (props.inline) {
      return <div className="min-h-[300px]" aria-busy="true" />;
    }
    return <main className="sahl-app min-h-screen bg-[#f4f7fb]" aria-busy="true" />;
  }

  return <PageState {...props} tone="loading" />;
}

export function StateIcon({ tone }: { tone: PageStateTone }) {
  if (tone === "error") {
    return (
      <svg viewBox="0 0 24 24" className="h-8 w-8" aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.7" />
        <path
          d="M12 7.5v5.2M12 16.2v.2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" className="h-8 w-8" aria-hidden="true">
      <path
        d="M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M13.6 3.8V8h4.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}
