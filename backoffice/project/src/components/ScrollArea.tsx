import { useRef, type ReactNode } from 'react';

// The one scrolling pane under the pinned header/filters on list pages.
// While it is actively scrolling, its content stops receiving pointer events
// (see index.css), so rows sliding under a stationary mouse don't each flash
// their hover highlight — that flicker read as "colors changing while
// scrolling sideways" (2026-09-24).
export function ScrollArea({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);

  function handleScroll() {
    const el = ref.current;
    if (!el) return;
    el.dataset.scrolling = 'true';
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { delete el.dataset.scrolling; }, 150);
  }

  return (
    <div ref={ref} className={className} onScroll={handleScroll}>
      {children}
    </div>
  );
}
