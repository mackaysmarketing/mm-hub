"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Sprout,
  CircleDollarSign,
  Users,
  Shield,
  ChevronDown,
  ChevronRight,
  LayoutDashboard,
  TrendingUp,
  Receipt,
  FileText,
  ShieldCheck,
  LineChart,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";

const MODULE_ICONS: Record<string, React.ReactNode> = {
  Sprout: <Sprout className="h-5 w-5" />,
  CircleDollarSign: <CircleDollarSign className="h-5 w-5" />,
};

const MENU_ICONS: Record<string, React.ReactNode> = {
  LayoutDashboard: <LayoutDashboard className="h-3.5 w-3.5" />,
  TrendingUp: <TrendingUp className="h-3.5 w-3.5" />,
  Receipt: <Receipt className="h-3.5 w-3.5" />,
  FileText: <FileText className="h-3.5 w-3.5" />,
  ShieldCheck: <ShieldCheck className="h-3.5 w-3.5" />,
  LineChart: <LineChart className="h-3.5 w-3.5" />,
};

interface ModuleUser {
  userId: string;
  name: string;
  email: string;
  userActive: boolean;
  role: string;
  active: boolean;
}

interface ModuleRole {
  role: string;
  label: string;
  description: string;
  capabilities: string[];
  defaultMenuItems: string[];
}

interface ModuleMenuItem {
  id: string;
  label: string;
  icon: string;
}

interface ModuleData {
  id: string;
  name: string;
  icon: string;
  basePath: string;
  totalUsers: number;
  activeUsers: number;
  roleCounts: Record<string, number>;
  roles: ModuleRole[];
  menuItems: ModuleMenuItem[];
  users: ModuleUser[];
}

export default function ModulesPage() {
  const [expandedModules, setExpandedModules] = useState<Set<string>>(
    new Set(["grower-portal"])
  );

  const { data: modules, isLoading } = useQuery<ModuleData[]>({
    queryKey: ["hub-admin-modules"],
    queryFn: () => fetch("/api/hub-admin/modules").then((r) => r.json()),
  });

  function toggleModule(id: string) {
    setExpandedModules((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-soil">Modules</h1>

      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {(modules ?? []).map((mod) => {
            const isExpanded = expandedModules.has(mod.id);
            return (
              <ModuleCard
                key={mod.id}
                module={mod}
                isExpanded={isExpanded}
                onToggle={() => toggleModule(mod.id)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function ModuleCard({
  module: mod,
  isExpanded,
  onToggle,
}: {
  module: ModuleData;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const hasRoles = mod.roles.length > 0;

  return (
    <div className="rounded-xl border border-sand bg-warmwhite overflow-hidden">
      {/* Module header */}
      <div
        className="flex items-center gap-4 p-5 cursor-pointer hover:bg-cream/30 transition-colors"
        onClick={onToggle}
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-canopy/10 text-canopy">
          {MODULE_ICONS[mod.icon] ?? <Shield className="h-5 w-5" />}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-soil">{mod.name}</h2>
            <span className="rounded-full bg-sand px-2 py-0.5 text-xs text-bark">
              {mod.id}
            </span>
          </div>
          <p className="text-xs text-stone">
            {mod.basePath === "/" ? "Root path" : mod.basePath}
            {" · "}
            {mod.roles.length} role{mod.roles.length !== 1 ? "s" : ""}
            {" · "}
            {mod.menuItems.length} menu item{mod.menuItems.length !== 1 ? "s" : ""}
          </p>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-6">
          <div className="text-center">
            <p className="text-lg font-semibold text-soil">{mod.activeUsers}</p>
            <p className="text-xs text-stone">Active</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-semibold text-bark">{mod.totalUsers}</p>
            <p className="text-xs text-stone">Total</p>
          </div>
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-stone" />
          ) : (
            <ChevronRight className="h-4 w-4 text-stone" />
          )}
        </div>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-sand">
          {/* Roles section */}
          {hasRoles && (
            <div className="p-5">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-stone">
                Roles
              </h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {mod.roles.map((role) => (
                  <div
                    key={role.role}
                    className="rounded-lg border border-sand/70 bg-cream/30 p-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-soil">
                        {role.label}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-forest/10 px-2 py-0.5 text-xs font-medium text-forest">
                        <Users className="h-3 w-3" />
                        {mod.roleCounts[role.role] ?? 0}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-stone">{role.description}</p>
                    {role.capabilities.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {role.capabilities.map((cap) => (
                          <span
                            key={cap}
                            className="rounded bg-sand/80 px-1.5 py-0.5 text-[10px] font-medium text-bark"
                          >
                            {cap}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Menu items */}
          {mod.menuItems.length > 0 && (
            <div className="border-t border-sand/50 px-5 py-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone">
                Menu Items
              </h3>
              <div className="flex flex-wrap gap-2">
                {mod.menuItems.map((item) => (
                  <span
                    key={item.id}
                    className="inline-flex items-center gap-1.5 rounded-full border border-sand bg-white px-2.5 py-1 text-xs text-bark"
                  >
                    {MENU_ICONS[item.icon] ?? null}
                    {item.label}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Users table */}
          {mod.users.length > 0 && (
            <div className="border-t border-sand/50 p-5">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-stone">
                Assigned Users ({mod.users.length})
              </h3>
              <div className="rounded-lg border border-sand">
                <Table>
                  <TableHeader>
                    <TableRow className="border-sand hover:bg-transparent">
                      <TableHead className="text-xs text-stone">Name</TableHead>
                      <TableHead className="text-xs text-stone">Email</TableHead>
                      <TableHead className="text-xs text-stone">Role</TableHead>
                      <TableHead className="text-xs text-stone">Module Access</TableHead>
                      <TableHead className="text-xs text-stone">User Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mod.users.map((user) => {
                      const roleDef = mod.roles.find(
                        (r) => r.role === user.role
                      );
                      return (
                        <TableRow
                          key={user.userId}
                          className="border-sand/50"
                        >
                          <TableCell className="font-medium text-soil">
                            {user.name}
                          </TableCell>
                          <TableCell className="text-bark">
                            {user.email}
                          </TableCell>
                          <TableCell>
                            <span className="rounded-full bg-forest/10 px-2 py-0.5 text-xs font-medium text-forest">
                              {roleDef?.label ?? user.role}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                user.active
                                  ? "bg-canopy/10 text-canopy"
                                  : "bg-blaze/10 text-blaze"
                              }`}
                            >
                              {user.active ? "Active" : "Inactive"}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                user.userActive
                                  ? "bg-canopy/10 text-canopy"
                                  : "bg-blaze/10 text-blaze"
                              }`}
                            >
                              {user.userActive ? "Active" : "Inactive"}
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {/* Empty state for modules with no config */}
          {!hasRoles && mod.users.length === 0 && (
            <div className="p-8 text-center text-sm text-stone">
              This module has not been configured yet. No roles or menu items
              defined.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
