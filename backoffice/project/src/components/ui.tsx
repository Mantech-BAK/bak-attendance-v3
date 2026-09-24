import type { ReactNode } from 'react';
import { X, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

// One label style for every form field / filter in the app.
export const FIELD_LABEL = 'text-xs font-semibold uppercase tracking-wide text-slate-500';

export function Card({
  children,
  className,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.08)] transition-all duration-300 ease-out',
        onClick && 'cursor-pointer hover:-translate-y-0.5 hover:border-slate-200 hover:shadow-[0_1px_2px_rgba(15,23,42,0.04),0_16px_32px_-12px_rgba(15,23,42,0.14)]',
        className,
      )}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
    >
      {children}
    </div>
  );
}

export function Badge({
  children,
  variant = 'neutral',
}: {
  children: ReactNode;
  variant?: 'neutral' | 'success' | 'warning' | 'error' | 'info' | 'accent';
}) {
  const styles: Record<string, string> = {
    neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
    success: 'bg-success-50 text-success-700 ring-success-200',
    warning: 'bg-warning-50 text-warning-700 ring-warning-200',
    error: 'bg-danger-50 text-danger-700 ring-danger-200',
    info: 'bg-info-50 text-info-700 ring-info-200',
    accent: 'bg-brand-50 text-brand-700 ring-brand-200',
  };
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold tracking-tight ring-1 ring-inset transition-colors duration-150', styles[variant])}>
      {children}
    </span>
  );
}

export function Button({
  children,
  onClick,
  type = 'button',
  variant = 'primary',
  size = 'md',
  disabled,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  variant?: 'primary' | 'secondary' | 'ghost' | 'success' | 'danger';
  size?: 'sm' | 'md';
  disabled?: boolean;
  className?: string;
}) {
  const variants: Record<string, string> = {
    primary: 'bg-gradient-to-b from-brand-500 to-brand-600 text-white shadow-sm shadow-brand-600/25 hover:from-brand-600 hover:to-brand-700 hover:shadow-md hover:shadow-brand-600/30 focus-visible:outline-brand-600 active:scale-[0.98]',
    success: 'bg-gradient-to-b from-success-500 to-success-600 text-white shadow-sm shadow-success-600/25 hover:from-success-600 hover:to-success-700 hover:shadow-md hover:shadow-success-600/30 focus-visible:outline-success-600 active:scale-[0.98]',
    danger: 'bg-gradient-to-b from-danger-500 to-danger-600 text-white shadow-sm shadow-danger-600/25 hover:from-danger-600 hover:to-danger-700 hover:shadow-md hover:shadow-danger-600/30 focus-visible:outline-danger-600 active:scale-[0.98]',
    secondary: 'bg-white text-slate-700 ring-1 ring-inset ring-slate-300 shadow-sm hover:bg-slate-50 hover:ring-slate-400 active:scale-[0.98]',
    ghost: 'text-slate-600 hover:bg-slate-100 active:scale-[0.98]',
  };
  const sizes: Record<string, string> = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2.5 text-sm',
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-all duration-150 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100',
        variants[variant],
        sizes[size],
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Select({
  value,
  onChange,
  children,
  label,
  id,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
  label?: string;
  id?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={id} className={FIELD_LABEL}>{label}</label>
      )}
      <div className="relative">
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="w-full appearance-none rounded-lg border border-slate-300 bg-white py-2.5 pl-3 pr-9 text-sm text-slate-900 shadow-sm transition-all duration-150 hover:border-slate-400 focus:border-teal-500 focus:outline-none focus:ring-4 focus:ring-teal-500/15 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      </div>
    </div>
  );
}

export function Input({
  value,
  onChange,
  label,
  id,
  type = 'text',
  placeholder,
  lang,
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  id?: string;
  type?: string;
  placeholder?: string;
  lang?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={id} className={FIELD_LABEL}>{label}</label>
      )}
      <input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        lang={lang}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm transition-all duration-150 placeholder:text-slate-400 hover:border-slate-400 focus:border-teal-500 focus:outline-none focus:ring-4 focus:ring-teal-500/15"
      />
    </div>
  );
}

export function Textarea({
  value,
  onChange,
  label,
  id,
  placeholder,
  rows = 4,
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  id?: string;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={id} className={FIELD_LABEL}>{label}</label>
      )}
      <textarea
        id={id}
        value={value}
        placeholder={placeholder}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm transition-all duration-150 placeholder:text-slate-400 hover:border-slate-400 focus:border-teal-500 focus:outline-none focus:ring-4 focus:ring-teal-500/15"
      />
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  message,
}: {
  icon: ReactNode;
  title: string;
  message: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-100 to-slate-50 text-slate-400 ring-1 ring-slate-200/70">
        {icon}
      </div>
      <div>
        <p className="text-sm font-semibold text-slate-700">{title}</p>
        <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{message}</p>
      </div>
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl shadow-slate-900/20 ring-1 ring-black/5"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tight text-slate-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-teal-600" />
    </div>
  );
}
