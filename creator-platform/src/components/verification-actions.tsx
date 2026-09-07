"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, RefreshCw } from "lucide-react";

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("copy_failed");
}

export function VerificationCodeCopy({ code }: { code: string }) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");

  async function handleCopy() {
    try {
      await copyText(code);
      setState("copied");
    } catch {
      setState("error");
    }
  }

  return (
    <>
      <button
        aria-label={`Copy verification code ${code}`}
        className="verification-code__copy"
        onClick={handleCopy}
        type="button"
      >
        {state === "copied" ? <Check aria-hidden="true" size={15} /> : <Copy aria-hidden="true" size={15} />}
        <span>{state === "copied" ? "Copied" : "Copy"}</span>
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {state === "copied"
          ? "Verification code copied."
          : state === "error"
            ? "The code could not be copied automatically. Select and copy the visible code."
            : ""}
      </span>
    </>
  );
}

export function VerificationStatusRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      className="button button--ghost"
      disabled={pending}
      onClick={() => startTransition(() => router.refresh())}
      type="button"
    >
      <RefreshCw aria-hidden="true" size={14} />
      {pending ? "Refreshing…" : "Refresh status"}
    </button>
  );
}
