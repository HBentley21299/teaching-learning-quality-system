import { useEffect, useState, type KeyboardEvent } from "react";

/** Keep focus in the search field while the keyboard explores its popup. */
export function useComboboxNavigation({ open, setOpen, optionIds, onSelect }: {
  open: boolean;
  setOpen: (open: boolean) => void;
  optionIds: string[];
  onSelect: (index: number) => void;
}) {
  const [activeIndex, setActiveIndex] = useState(-1);
  const activeId = open ? optionIds[activeIndex] : undefined;

  useEffect(() => {
    if (activeId && typeof document !== "undefined") {
      document.getElementById(activeId)?.scrollIntoView?.({ block: "nearest" });
    }
  }, [activeId]);

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      const count = optionIds.length;
      setActiveIndex(current => !count ? -1 : !open || current < 0
        ? event.key === "ArrowDown" ? 0 : count - 1
        : event.key === "ArrowDown" ? Math.min(current + 1, count - 1) : Math.max(current - 1, 0));
    } else if (event.key === "Enter" && open) {
      // Never submit the surrounding form while the user is choosing a result.
      event.preventDefault();
      if (optionIds.length) onSelect(activeIndex >= 0 && activeIndex < optionIds.length ? activeIndex : 0);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      setActiveIndex(-1);
    }
  }

  return { activeIndex, activeId, setActiveIndex, onKeyDown };
}
