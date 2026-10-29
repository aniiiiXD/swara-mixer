"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

const LINKS = [
  { href: "/today", label: "Today" },
  { href: "/songs", label: "Library" },
  { href: "/mix", label: "Mix" },
  { href: "/pitch", label: "Pitch" },
  { href: "/learn", label: "Learn" },
  { href: "/progress", label: "Progress" },
];

export default function AppNav() {
  const path = usePathname();
  const studio = path.startsWith("/mix") || path.startsWith("/pitch") || path.startsWith("/songs");
  useEffect(() => {
    document.body.dataset.tonicMode = path === "/" ? "landing" : studio ? "studio" : "coach";
    return () => { delete document.body.dataset.tonicMode; };
  }, [path, studio]);
  // landing has its own header; practice runner is distraction-free
  if (path === "/" || path.startsWith("/practice")) return null;
  const active = (href: string) => path === href || path.startsWith(`${href}/`);
  return (
    <nav className={`app-nav ${studio ? "app-nav--studio" : "app-nav--coach"}`} aria-label="Primary navigation">
      <Link href="/" className="app-nav__brand">
        <span className="app-nav__mark" aria-hidden>◒</span>Tonic
      </Link>
      <div className="app-nav__links">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`app-nav__link ${active(l.href) ? "app-nav__link--active" : ""}`}
          >
            {l.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
