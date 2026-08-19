import Link from "next/link";
import { Wrench, ArrowRight, Lock } from "lucide-react";
import { TopBar } from "@/components/top-bar";
import { listVisibleTools } from "@/lib/tools/access";

export const dynamic = "force-dynamic";

/**
 * The tools list is now filtered by what the caller may actually open, so a
 * gated tool is not advertised to someone who would only be bounced back here.
 * Ungated tools still show for every internal user exactly as before.
 */
export default async function ToolsIndexPage() {
  const tools = await listVisibleTools();

  return (
    <div className="space-y-6">
      <TopBar title="Tools" />
      <p className="text-sm text-bark">
        Internal automations for Mackays staff. More tools land here over
        time — this section is the home for all of them.
      </p>

      {tools.length === 0 ? (
        <div className="rounded-xl border border-dashed border-sand bg-warmwhite p-10 text-center">
          <Lock className="mx-auto h-6 w-6 text-clay" />
          <p className="mt-2 text-sm text-bark">
            You do not have access to any tools yet. A hub admin can grant it.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {tools.map((tool) => (
            <Link
              key={tool.href}
              href={tool.href}
              className="group rounded-xl border border-sand bg-warmwhite p-5 transition hover:border-forest/40"
            >
              <div className="flex items-start justify-between">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-forest/10 text-forest">
                  <Wrench className="h-4 w-4" />
                </div>
                <ArrowRight className="h-4 w-4 text-stone transition group-hover:translate-x-0.5 group-hover:text-forest" />
              </div>
              <h3 className="mt-3 text-sm font-semibold text-soil">{tool.name}</h3>
              <p className="mt-1 text-xs text-bark">{tool.description}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
