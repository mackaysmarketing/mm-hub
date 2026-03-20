"use client";

import Link from "next/link";

export default function GrowerPortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border-l-4 border-blaze bg-warmwhite p-8 shadow-sm">
        <h2 className="font-display text-lg font-bold text-soil">
          Something went wrong
        </h2>
        <p className="mt-2 text-sm text-stone">
          {error.message?.length > 200
            ? error.message.slice(0, 200) + "…"
            : error.message || "An unexpected error occurred."}
        </p>
        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={reset}
            className="rounded-lg bg-canopy px-4 py-2 text-sm font-medium text-white transition hover:bg-canopy-light"
          >
            Try again
          </button>
          <Link
            href="/dashboard"
            className="text-sm text-stone transition hover:text-soil"
          >
            Go to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
