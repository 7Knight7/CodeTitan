"use client";
import { useState } from "react";
import Icon, { Logo } from "./Icon";

/** Centred card for the pages people open before they have a session (first-run setup, invitations). */
export default function AuthFrame({ title, sub, children }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="panel w-full max-w-[28rem] p-6 sm:p-8">
        <div className="mb-6 flex items-center gap-3">
          <Logo className="h-9 w-9" />
          <span className="text-lg font-semibold tracking-tight">Live Brand Check</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {sub && <p className="mt-1.5 text-sm leading-6 text-muted">{sub}</p>}
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}

/** A password box with an eye button to show or hide what was typed. */
export function PasswordInput({ id, value, onChange, autoComplete = "current-password", minLength, describedBy }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input id={id} type={show ? "text" : "password"} autoComplete={autoComplete} required minLength={minLength} maxLength={128}
        className="field pr-11" value={value} onChange={(e) => onChange(e.target.value)} aria-describedby={describedBy} />
      <button type="button" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"} aria-pressed={show}
        title={show ? "Hide password" : "Show password"}
        className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted hover:bg-canvas hover:text-ink">
        {show ? (
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 3l18 18M10.6 5.1A10.4 10.4 0 0 1 12 5c6 0 9.5 7 9.5 7a17 17 0 0 1-2.6 3.4M6.6 6.6C3.9 8.3 2.5 12 2.5 12S6 19 12 19c1.7 0 3.2-.5 4.5-1.2M9.9 9.9a3 3 0 0 0 4.2 4.2" />
          </svg>
        ) : <Icon name="eye" className="h-4 w-4" />}
      </button>
    </div>
  );
}

/** Password box with the same rules the server checks, so people see the problem before sending. */
export function NewPassword({ id = "new-password", label = "Password", value, onChange }) {
  const tooShort = value.length > 0 && value.length < 10;
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <PasswordInput id={id} value={value} onChange={onChange} autoComplete="new-password" minLength={10} describedBy={`${id}-help`} />
      <p id={`${id}-help`} className={`mt-1 text-xs ${tooShort ? "text-blocker" : "text-muted"}`}>
        At least 10 characters. A short sentence works well, for example &ldquo;mango rain at 6pm&rdquo;. Don&rsquo;t use your name or email.
      </p>
    </div>
  );
}

export function FormError({ children }) {
  return children ? <p role="alert" className="rounded-md bg-blocker-soft px-3 py-2 text-sm text-blocker">{children}</p> : null;
}
