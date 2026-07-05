"use client";

import { useState } from "react";

type CopyLinkButtonProps = {
  className?: string;
  label?: string;
  link: string;
};

export function CopyLinkButton({
  className,
  label = "Copy link",
  link,
}: CopyLinkButtonProps) {
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <button
      className={
        className ??
        "rounded-[0.8rem] border border-white/[0.1] px-3 py-2 text-xs text-foreground transition hover:border-white/[0.18] hover:bg-white/[0.05]"
      }
      onClick={copyLink}
      type="button"
    >
      {copied ? "Copied" : label}
    </button>
  );
}
