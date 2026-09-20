// Pure-SVG donut chart — no charting library dependency, just enough to
// render a status breakdown at a glance. Segments are drawn as stroked arcs
// on a circle (stroke-dasharray trick), so the whole thing is a handful of
// <circle> elements, easy to reason about and to keep in sync with the
// design system's status colors (see STATUS_COLORS below).
type DonutSegment = {
  label: string;
  value: number;
  colorClass: string; // Tailwind stroke-* class, e.g. "stroke-emerald-500"
  dotClass: string; // matching bg-* class for the legend dot
};

export function DonutChart({
  segments,
  size = 148,
  strokeWidth = 20,
  centerLabel,
  centerValue,
}: {
  segments: DonutSegment[];
  size?: number;
  strokeWidth?: number;
  centerLabel: string;
  centerValue: number;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = segments.reduce((sum, s) => sum + s.value, 0);

  let offsetSoFar = 0;

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:gap-7">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          {/* Track — shown whenever there's no data at all, so the chart
              never renders as a blank void. */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={strokeWidth}
            className="stroke-slate-100"
          />
          {total > 0 &&
            segments
              .filter((s) => s.value > 0)
              .map((s) => {
                const fraction = s.value / total;
                const dash = fraction * circumference;
                const gap = circumference - dash;
                const dashOffset = -offsetSoFar;
                offsetSoFar += dash;
                return (
                  <circle
                    key={s.label}
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    fill="none"
                    strokeWidth={strokeWidth}
                    strokeDasharray={`${dash} ${gap}`}
                    strokeDashoffset={dashOffset}
                    strokeLinecap={segments.filter((x) => x.value > 0).length > 1 ? 'butt' : 'round'}
                    className={`${s.colorClass} transition-all duration-500 ease-out`}
                  />
                );
              })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold tabular-nums tracking-tight text-slate-900">{centerValue}</span>
          <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{centerLabel}</span>
        </div>
      </div>

      <ul className="w-full min-w-0 space-y-2.5 sm:w-auto">
        {segments.map((s) => {
          const pct = total > 0 ? Math.round((s.value / total) * 100) : 0;
          return (
            <li key={s.label} className="flex items-center gap-2.5 text-sm">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${s.dotClass}`} />
              <span className="min-w-0 flex-1 truncate font-medium text-slate-700">{s.label}</span>
              <span className="font-semibold tabular-nums text-slate-900">{s.value}</span>
              <span className="w-9 shrink-0 text-right text-xs tabular-nums text-slate-400">{pct}%</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
