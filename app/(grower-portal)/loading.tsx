export default function GrowerPortalLoading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center bg-parchment">
      <div className="flex flex-col items-center gap-4">
        <div className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-canopy" />
          <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-canopy [animation-delay:150ms]" />
          <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-canopy [animation-delay:300ms]" />
        </div>
        <p className="font-display text-sm text-stone">Loading…</p>
      </div>
    </div>
  );
}
