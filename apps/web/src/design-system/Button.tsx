import type { ComponentType, MouseEventHandler } from "react";
import type { LucideProps } from "lucide-react";

type ButtonProps = {
  children: string;
  disabled?: boolean;
  icon?: ComponentType<LucideProps>;
  variant?: "primary" | "secondary" | "quiet" | "danger";
  onClick?: MouseEventHandler<HTMLButtonElement>;
  title?: string;
  "aria-label"?: string;
  "aria-pressed"?: boolean;
};

export function Button({ children, disabled = false, icon: Icon, variant = "secondary", onClick, title, "aria-label": ariaLabel, "aria-pressed": ariaPressed }: ButtonProps) {
  return (
    <button
      className={`button button-${variant}`}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      disabled={disabled}
      onClick={onClick}
      title={title ?? children}
      type="button"
    >
      {Icon ? <Icon aria-hidden="true" size={16} /> : null}
      <span>{children}</span>
    </button>
  );
}
