"use client";

import Link from "next/link";
import { ArrowUpRight, Menu, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { BrandMark } from "@/components/brand-mark";

export function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;

    const firstLink = menuPanelRef.current?.querySelector<HTMLAnchorElement>("a");
    firstLink?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  const closeMenu = () => setMenuOpen(false);

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link className="wordmark" href="/" aria-label="GoTall creator program home">
          <BrandMark />
          <span>Creator program</span>
        </Link>

        <nav className="site-nav" aria-label="Main navigation">
          <Link href="/#how-it-works">How it works</Link>
          <Link href="/#offer">The offer</Link>
          <Link href="/#questions">Questions</Link>
        </nav>

        <div className="site-header__actions">
          <Link className="button button--ghost header-sign-in" href="/auth/sign-in">
            Sign in
          </Link>
          <Link className="button button--ink" href="/apply">
            Apply
            <ArrowUpRight aria-hidden="true" size={16} />
          </Link>
          <button
            ref={menuButtonRef}
            className="mobile-menu"
            type="button"
            aria-label={menuOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={menuOpen}
            aria-controls="mobile-navigation"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X aria-hidden="true" size={20} /> : <Menu aria-hidden="true" size={20} />}
          </button>
        </div>

        <div
          ref={menuPanelRef}
          id="mobile-navigation"
          className="mobile-navigation"
          hidden={!menuOpen}
        >
          <nav aria-label="Mobile navigation">
            <Link href="/#how-it-works" onClick={closeMenu}>How it works</Link>
            <Link href="/#offer" onClick={closeMenu}>The offer</Link>
            <Link href="/#questions" onClick={closeMenu}>Questions</Link>
          </nav>
          <div>
            <Link className="button button--ghost" href="/auth/sign-in" onClick={closeMenu}>
              Sign in
            </Link>
            <Link className="button button--ink" href="/apply" onClick={closeMenu}>
              Apply
              <ArrowUpRight aria-hidden="true" size={16} />
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}
