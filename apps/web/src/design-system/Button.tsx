import type { ButtonHTMLAttributes, ComponentType, ReactNode, Ref } from "react";
import { LoaderCircle, type LucideProps } from "lucide-react";

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  children: ReactNode;
  icon?: ComponentType<LucideProps>;
  variant?: "primary" | "secondary" | "quiet" | "danger";
  /** Prevent duplicate submissions while preserving a clear busy state. */
  busy?: boolean;
  ref?: Ref<HTMLButtonElement>;
};

export function Button({ children, disabled = false, icon: Icon, variant = "secondary", busy = false, className = "", type = "button", ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={`button button-${variant} ${className}`.trim()}
      aria-busy={busy || props["aria-busy"] || undefined}
      disabled={disabled || busy}
      type={type}
    >
      {busy ? <LoaderCircle aria-hidden="true" className="button-busy-icon" size={17} /> : Icon ? <Icon aria-hidden="true" size={17} /> : null}
      <span>{children}</span>
    </button>
  );
}
