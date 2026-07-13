import type { ComponentType } from "react";
import type { LucideProps } from "lucide-react";

type ButtonProps = {
  children: string;
  disabled?: boolean;
  icon?: ComponentType<LucideProps>;
  variant?: "primary" | "secondary" | "quiet" | "danger";
  onClick?: () => void;
  title?: string;
};

export function Button({ children, disabled = false, icon: Icon, variant = "secondary", onClick, title }: ButtonProps) {
  return (
    <button
      className={`button button-${variant}`}
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
