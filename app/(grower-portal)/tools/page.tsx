import Link from "next/link";
import { Wrench, ArrowRight } from "lucide-react";
import { TopBar } from "@/components/top-bar";

const TOOLS = [
  {
    href: "/tools/consignor-auto-assign",
    name: "Auto FT Consignor Update",
    description:
      "Fills a blank consignor on newly-arrived FreshTrack orders for known customers, per an admin-managed mapping.",
  },
];

export default function ToolsIndexPage() {
  return (
    <div className="space-y-6">
      <TopBar title="Tools" />
      <p className="text-sm text-bark">
        Internal automations for Mackays staff. More tools land here over
        time — this section is the home for all of them.
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {TOOLS.map((tool) => (
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
    </div>
  );
}
