import { MackaysLogo } from "@/components/mackays-logo";

export default function GrowerPortalLoading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center bg-parchment">
      <div className="flex flex-col items-center gap-4">
        <MackaysLogo width={120} className="animate-pulse" />
        <p className="font-display text-sm text-stone">Loading…</p>
      </div>
    </div>
  );
}
