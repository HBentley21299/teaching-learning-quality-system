import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/** Add a keyboard scroll stop only when a table is wider than its container. */
export function ScrollableTableRegion({ children, className = "", label = "Results" }: {
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  const scrollArea = useRef<HTMLDivElement>(null);
  const scrollHelp = useId();
  const [overflows, setOverflows] = useState(false);
  useEffect(() => {
    const element = scrollArea.current;
    if (!element) return;
    const measure = () => setOverflows(element.scrollWidth > element.clientWidth + 1);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(element);
    if (element.firstElementChild) observer?.observe(element.firstElementChild);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [children]);

  return <div className={`table-shell data-table-scroll ${className}`.trim()} ref={scrollArea}
    tabIndex={overflows ? 0 : undefined} role={overflows ? "region" : undefined}
    aria-label={overflows ? `${label}: scroll to see all columns` : undefined}
    aria-describedby={overflows ? scrollHelp : undefined}>
    {children}
    {overflows ? <span className="sr-only" id={scrollHelp}>Use the left and right arrow keys to scroll through the columns.</span> : null}
  </div>;
}
