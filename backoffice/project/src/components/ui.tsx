import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

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
      className={cn('rounded-2xl border border-slate-200 bg-white shadow-sm', className)}
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
    success: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    warning: 'bg-amber-50 text-amber-700 ring-amber-200',
    error: 'bg-rose-50 text-rose-700 ring-rose-200',
    info: 'bg-sky-50 text-sky-700 ring-sky-200',
    accent: 'bg-teal-50 text-teal-700 ring-teal-200',
  };
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset', styles[variant])}>
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
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md';
  disabled?: boolean;
  className?: string;
}) {
  const variants: Record<string, string> = {
    primary: 'bg-teal-600 text-white hover:bg-teal-700 focus-visible:outline-teal-600 shadow-sm',
    secondary: 'bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50',
    ghost: 'text-slate-600 hover:bg-slate-100',
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
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
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
        <label htmlFor={id} className="text-sm font-medium text-slate-700">{label}</label>
      )}
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm transition focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
      >
        {children}
      </select>
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
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  id?: string;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-slate-700">{label}</label>
      )}
      <input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
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
        <label htmlFor={id} className="text-sm font-medium text-slate-700">{label}</label>
      )}
      <textarea
        id={id}
        value={value}
        placeholder={placeholder}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
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
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
        {icon}
      </div>
      <div>
        <p className="text-sm font-semibold text-slate-700">{title}</p>
        <p className="mt-1 text-sm text-slate-500">{message}</p>
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
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
