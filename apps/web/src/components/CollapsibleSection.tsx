import { ChevronDown } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

export function CollapsibleSection({
  title,
  count,
  countLabel = "records",
  defaultOpen = false,
  className = "",
  tools,
  children
}: {
  title: string;
  count: number;
  countLabel?: string;
  defaultOpen?: boolean;
  className?: string;
  tools?: ReactNode;
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const contentId = useId();
  return (
    <section className={`panel collapsible-panel ${className}`.trim()}>
      <div className="panel-heading collapsible-panel-heading">
        <h2>
          <button
            aria-controls={contentId}
            aria-expanded={isOpen}
            className={`panel-collapse-button${isOpen ? " is-open" : ""}`}
            onClick={() => setIsOpen((current) => !current)}
            type="button"
          >
            <ChevronDown aria-hidden="true" size={18} />
            <span>{title}</span>
          </button>
        </h2>
        <span>{count} {count === 1 ? countLabel.replace(/s$/, "") : countLabel}</span>
        {tools ? <div className="collapsible-panel-tools">{tools}</div> : null}
      </div>
      {isOpen ? <div id={contentId}>{children}</div> : null}
    </section>
  );
}
