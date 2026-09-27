"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const INTERVAL_MS = 5_000;

// Re-renders the server page while the quote is still being prepared.
export function QuoteStatusRefresh() {
  const router = useRouter();

  useEffect(() => {
    const timer = setInterval(() => router.refresh(), INTERVAL_MS);
    return () => clearInterval(timer);
  }, [router]);

  return null;
}
