"use client";

import { useEffect, useId, useRef, useState } from "react";

type AppAccountMenuProps = {
  signedInAs: string;
  changeAccountAction: () => Promise<void>;
  signOutAction: () => Promise<void>;
};

export function AppAccountMenu({
  signedInAs,
  changeAccountAction,
  signOutAction,
}: AppAccountMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        aria-controls={menuId}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-4 py-2 text-xs text-foreground/82 backdrop-blur transition hover:border-white/[0.12] hover:bg-white/[0.08]"
        onClick={() => setIsOpen((current) => !current)}
        type="button"
      >
        <span className="max-w-[14rem] truncate">{signedInAs}</span>
        <svg
          aria-hidden="true"
          className={`h-3.5 w-3.5 text-foreground/58 transition ${
            isOpen ? "rotate-180" : ""
          }`}
          fill="none"
          viewBox="0 0 16 16"
        >
          <path
            d="M4.25 6.5L8 10.25L11.75 6.5"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.2"
          />
        </svg>
      </button>

      {isOpen ? (
        <div
          className="absolute right-0 z-20 mt-2 w-[17rem] rounded-[1.1rem] border border-white/[0.08] bg-[#0b0b0d] p-1.5 shadow-[0_28px_80px_rgba(0,0,0,0.48)]"
          id={menuId}
          role="menu"
        >
          <div className="rounded-[0.9rem] border border-white/[0.06] bg-black/[0.18] px-3 py-3">
            <p className="text-[0.58rem] uppercase tracking-[0.22em] text-muted-foreground">
              Signed in as
            </p>
            <p className="mt-1 truncate text-sm text-foreground">{signedInAs}</p>
          </div>

          <form action={changeAccountAction} className="mt-1.5">
            <button
              className="flex w-full flex-col items-start rounded-[0.9rem] px-3 py-2.5 text-left transition hover:bg-white/[0.05]"
              role="menuitem"
              type="submit"
            >
              <span className="text-sm text-foreground">Change account</span>
              <span className="mt-0.5 text-xs text-muted-foreground">
                Use a different sign-in
              </span>
            </button>
          </form>

          <form action={signOutAction} className="mt-1">
            <button
              className="flex w-full flex-col items-start rounded-[0.9rem] px-3 py-2.5 text-left transition hover:bg-white/[0.05]"
              role="menuitem"
              type="submit"
            >
              <span className="text-sm text-foreground">Sign out</span>
              <span className="mt-0.5 text-xs text-muted-foreground">
                End this session
              </span>
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
