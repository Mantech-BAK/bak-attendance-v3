import type { ReactNode } from 'react';

export function PageHeader({
  title,
  subtitle,
  action,
  compact,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={compact ? 'mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between' : 'mb-9 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between'}>
      <div className="flex items-start gap-3">
        <span className="mt-1.5 h-7 w-1 shrink-0 rounded-full bg-gradient-to-b from-teal-500 to-sky-500" />
        <div>
          <h1 className={compact ? 'text-2xl font-extrabold leading-tight tracking-tight text-slate-900' : 'text-[28px] font-extrabold leading-tight tracking-tight text-slate-900'}>{title}</h1>
          {subtitle && <p className={compact ? 'mt-0.5 text-sm text-slate-500' : 'mt-1.5 text-sm leading-relaxed text-slate-500'}>{subtitle}</p>}
        </div>
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}
