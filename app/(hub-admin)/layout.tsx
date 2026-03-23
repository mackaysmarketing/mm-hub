import Link from "next/link";
import { requireHubAdmin } from "@/lib/auth";
import { MackaysLogo } from "@/components/mackays-logo";
import { Shield, Users, Boxes, Building2 } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function HubAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireHubAdmin();

  return (
    <div className="flex min-h-screen">
      <aside className="flex h-screen w-[240px] flex-shrink-0 flex-col border-r border-sand bg-warmwhite">
        <div className="border-b border-sand px-4 py-5">
          <MackaysLogo width={140} />
          <div className="mt-1 flex items-center gap-1.5 text-xs text-stone">
            <Shield size={12} />
            Hub Admin
          </div>
        </div>
        <nav className="flex-1 py-3">
          <ul className="space-y-0.5">
            <li>
              <Link
                href="/hub-admin/users"
                className="mx-2 flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm text-bark transition hover:bg-cream hover:text-soil"
              >
                <Users size={18} />
                Users
              </Link>
            </li>
            <li>
              <Link
                href="/hub-admin/grower-groups"
                className="mx-2 flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm text-bark transition hover:bg-cream hover:text-soil"
              >
                <Building2 size={18} />
                Grower Groups
              </Link>
            </li>
            <li>
              <Link
                href="/hub-admin/modules"
                className="mx-2 flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm text-bark transition hover:bg-cream hover:text-soil"
              >
                <Boxes size={18} />
                Modules
              </Link>
            </li>
          </ul>
        </nav>
      </aside>
      <div className="flex flex-1 flex-col bg-parchment">
        <main className="flex-1 p-6">
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
