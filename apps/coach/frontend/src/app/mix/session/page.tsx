"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { MixWorkbench } from "@/components/MixWorkbench";

// Query param rather than a path segment: the desktop build is a static export,
// so every route must be known at build time. Same shape as /pitch?track=.
function MixSession() {
  const jobId = useSearchParams().get("job");

  if (!jobId) {
    return (
      <main className="studio-page"><div className="workspace flex max-w-6xl flex-col gap-4">
        <p className="font-body text-sm text-[var(--ink-dim)]">No track selected.</p>
        <Link href="/mix" className="font-body text-sm text-[var(--saffron)]">← back to Mix</Link>
      </div></main>
    );
  }
  return <MixWorkbench jobId={jobId} />;
}

export default function MixSessionPage() {
  return (
    <Suspense fallback={null}>
      <MixSession />
    </Suspense>
  );
}
