import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes } from "react";

/**
 * Shared primitives, hand-rolled on the token layer — no component library.
 * Everything reads semantic tokens so light/dark just works.
 */

export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("rounded-xl border border-edge bg-surface p-4", className)}>
      {children}
    </div>
  );
}

export function CardTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-muted">
      {children}
    </h2>
  );
}

type ButtonVariant = "primary" | "ghost" | "danger";

export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  const styles: Record<ButtonVariant, string> = {
    primary: "bg-accent text-accent-ink hover:opacity-90",
    ghost: "border border-edge bg-transparent text-ink hover:bg-hairline/40",
    danger: "bg-danger text-white hover:opacity-90",
  };
  return (
    <button
      className={cx(
        "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium",
        "transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        styles[variant],
        className,
      )}
      {...props}
    />
  );
}

export type BadgeTone =
  | "neutral"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "credit"
  | "debit"
  | "investment"
  | "transfer";

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  const tones: Record<BadgeTone, string> = {
    neutral: "bg-hairline/50 text-ink-secondary",
    success: "bg-success-bg text-success",
    warning: "bg-warning-bg text-warning",
    danger: "bg-danger-bg text-danger",
    info: "bg-info-bg text-info",
    credit: "bg-success-bg text-credit",
    debit: "bg-danger-bg text-debit",
    investment: "bg-info-bg text-investment",
    transfer: "bg-hairline/50 text-transfer",
  };
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx(
        "rounded-lg border border-edge bg-surface px-2.5 py-1.5 text-sm text-ink",
        "placeholder:text-ink-muted focus:border-accent focus:outline-none",
        className,
      )}
      {...props}
    />
  );
}

/** Accessible on/off pill switch — the styled replacement for a raw checkbox. */
export function Switch({
  checked,
  onChange,
  disabled,
  size = "md",
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  const dims = size === "sm" ? "h-3.5 w-6" : "h-4.5 w-8";
  const thumb = size === "sm" ? "h-2.5 w-2.5" : "h-3.5 w-3.5";
  const travel = size === "sm" ? "peer-checked:translate-x-2.5" : "peer-checked:translate-x-3.5";
  return (
    <span className={cx("relative inline-flex shrink-0", dims, disabled && "opacity-50", className)}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
      />
      <span
        className={cx(
          "absolute inset-0 rounded-full bg-hairline transition-colors duration-150",
          "peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent/50",
        )}
      />
      <span
        className={cx(
          "pointer-events-none absolute left-0.5 top-1/2 -translate-y-1/2 rounded-full bg-surface-raised shadow transition-transform duration-150",
          thumb,
          travel,
        )}
      />
    </span>
  );
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cx(
        "rounded-lg border border-edge bg-surface px-2.5 py-1.5 text-sm text-ink",
        "focus:border-accent focus:outline-none",
        className,
      )}
      {...props}
    />
  );
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("overflow-x-auto rounded-xl border border-edge", className)}>
      <table className="w-full border-collapse bg-surface text-sm">{children}</table>
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th
      className={cx(
        "border-b border-hairline px-3 py-2 text-left text-[11px] font-semibold",
        "uppercase tracking-wider text-ink-muted",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <td className={cx("border-b border-hairline/60 px-3 py-1.5 align-middle", className)}>
      {children}
    </td>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-edge py-12 text-center">
      <p className="text-sm font-medium text-ink-secondary">{title}</p>
      {hint ? <p className="text-xs text-ink-muted">{hint}</p> : null}
    </div>
  );
}
