"use client";

export function PaletteIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M10 2.5a7.5 7.5 0 1 0 0 15h1.1a1.7 1.7 0 0 0 1.1-3l-.2-.2a1.4 1.4 0 0 1 1-2.4h1.2A2.3 2.3 0 0 0 17.5 9.6 7.2 7.2 0 0 0 10 2.5Z" />
      <circle cx="6.1" cy="8" r=".9" fill="currentColor" stroke="none" />
      <circle cx="8.7" cy="5.4" r=".9" fill="currentColor" stroke="none" />
      <circle cx="12.3" cy="5.7" r=".9" fill="currentColor" stroke="none" />
      <circle cx="6" cy="11.6" r=".9" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function StatusGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="10" cy="10" r="6.5" />
      <path d="M10 6.3v4l2.4 1.4" />
    </svg>
  );
}

export function FieldGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M4 5.5h12M4 10h12M4 14.5h12" />
    </svg>
  );
}

export function TemplateGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="3" y="3" width="6" height="6" rx="1" />
      <rect x="11" y="3" width="6" height="6" rx="1" />
      <rect x="3" y="11" width="6" height="6" rx="1" />
      <rect x="11" y="11" width="6" height="6" rx="1" />
    </svg>
  );
}

export function MailGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="3" y="4.5" width="14" height="11" rx="1.5" />
      <path d="m3.5 6 6.5 5 6.5-5" />
    </svg>
  );
}

export function AppsGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="3" y="3" width="5" height="5" rx="1" />
      <rect x="12" y="3" width="5" height="5" rx="1" />
      <rect x="3" y="12" width="5" height="5" rx="1" />
      <rect x="12" y="12" width="5" height="5" rx="1" />
    </svg>
  );
}

export function BundleGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="m10 2.5 7 3.5-7 3.5-7-3.5 7-3.5Z" />
      <path d="m3 10 7 3.5 7-3.5M3 14l7 3.5 7-3.5" />
    </svg>
  );
}

export function AutomationGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M11 2 5 11h4l-1 7 7-9h-4l1-7Z" />
    </svg>
  );
}

export function Chevron() {
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3 shrink-0 text-subtle" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="m4.5 2.5 3.5 3.5-3.5 3.5" />
    </svg>
  );
}
