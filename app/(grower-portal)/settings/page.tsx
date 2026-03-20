"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Users,
  ClipboardCheck,
  RefreshCw,
  LogOut,
} from "lucide-react";

import { TopBar } from "@/components/top-bar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useUser } from "@/hooks/use-user";
import { createClient } from "@/lib/supabase/client";

const ADMIN_LINKS = [
  {
    href: "/admin/growers",
    label: "Grower Management",
    description: "Add and manage grower records",
    icon: Users,
    capability: "manage_users",
  },
  {
    href: "/admin/qa-entry",
    label: "QA Entry",
    description: "Create QA assessments and schedule audits",
    icon: ClipboardCheck,
    capability: "enter_qa",
  },
  {
    href: "/admin/sync-status",
    label: "Sync Status",
    description: "Monitor FreshTrack and NetSuite sync",
    icon: RefreshCw,
    capability: "trigger_sync",
  },
];

export default function SettingsPage() {
  const { session, loading } = useUser();
  const router = useRouter();

  const portalAccess = session?.moduleAccess.find(
    (m) => m.module_id === "grower-portal"
  );
  const capabilities =
    ((portalAccess?.config as Record<string, unknown>)?.capabilities as string[]) ?? [];
  const isHubAdmin = session?.hubUser.hub_role === "hub_admin";

  const visibleAdminLinks = ADMIN_LINKS.filter(
    (link) => isHubAdmin || capabilities.includes(link.capability)
  );

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <TopBar title="Settings" />
        <Skeleton className="h-[200px] rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <TopBar title="Settings" />

      {/* Account info */}
      <div className="rounded-xl border border-sand bg-warmwhite p-6">
        <h2 className="mb-4 text-sm font-semibold text-soil">Account</h2>
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-3">
            <span className="w-24 text-xs text-stone">Name</span>
            <span className="text-soil">{session?.hubUser.name}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="w-24 text-xs text-stone">Email</span>
            <span className="text-bark">{session?.hubUser.email}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="w-24 text-xs text-stone">Auth</span>
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                session?.hubUser.auth_provider === "microsoft"
                  ? "bg-blue-50 text-blue-700"
                  : "bg-sand/60 text-bark"
              }`}
            >
              {session?.hubUser.auth_provider === "microsoft"
                ? "Microsoft"
                : "Email"}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="w-24 text-xs text-stone">Role</span>
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                session?.hubUser.hub_role === "hub_admin"
                  ? "bg-canopy/10 text-canopy"
                  : "bg-cream text-bark"
              }`}
            >
              {session?.hubUser.hub_role === "hub_admin" ? "Hub Admin" : "User"}
            </span>
            {portalAccess && (
              <span className="inline-flex rounded-full bg-forest/10 px-2 py-0.5 text-xs text-forest">
                {portalAccess.module_role}
              </span>
            )}
          </div>
        </div>
        <div className="mt-4">
          <Button
            size="sm"
            variant="outline"
            className="border-sand text-bark"
            onClick={handleSignOut}
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </Button>
        </div>
      </div>

      {/* Admin links */}
      {visibleAdminLinks.length > 0 && (
        <div className="rounded-xl border border-sand bg-warmwhite p-6">
          <h2 className="mb-4 text-sm font-semibold text-soil">
            Administration
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {visibleAdminLinks.map((link) => {
              const Icon = link.icon;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className="flex items-start gap-3 rounded-lg border border-sand p-4 transition-colors hover:bg-cream"
                >
                  <Icon className="mt-0.5 h-5 w-5 shrink-0 text-forest" />
                  <div>
                    <p className="text-sm font-medium text-soil">
                      {link.label}
                    </p>
                    <p className="text-xs text-stone">{link.description}</p>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
