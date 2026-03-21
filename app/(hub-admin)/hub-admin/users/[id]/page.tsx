"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Save,
  Trash2,
  Plus,
  AlertTriangle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { MODULES } from "@/lib/modules";
import type { ModuleId } from "@/types/modules";

interface ModuleAccessRow {
  id: string;
  user_id: string;
  module_id: ModuleId;
  module_role: string;
  config: Record<string, unknown>;
  active: boolean;
  granted_by: string | null;
  created_at: string;
  updated_at: string;
}

interface UserDetail {
  id: string;
  name: string;
  email: string;
  auth_provider: string;
  hub_role: string;
  active: boolean;
  last_login_at: string | null;
  created_at: string;
  modules: ModuleAccessRow[];
}

interface Grower {
  id: string;
  name: string;
  code: string;
}

export default function EditUserPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  // User detail form state
  const [name, setName] = useState("");
  const [hubRole, setHubRole] = useState<"user" | "hub_admin">("user");
  const [active, setActive] = useState(true);
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [addModuleOpen, setAddModuleOpen] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const { data: user, isLoading } = useQuery<UserDetail>({
    queryKey: ["hub-admin-user", params.id],
    queryFn: () =>
      fetch(`/api/hub-admin/users/${params.id}`).then((r) => r.json()),
  });

  const { data: growers } = useQuery<Grower[]>({
    queryKey: ["hub-admin-growers"],
    queryFn: () => fetch("/api/hub-admin/growers").then((r) => r.json()),
  });

  // Sync form state when user loads
  useEffect(() => {
    if (user) {
      setName(user.name);
      setHubRole(user.hub_role as "user" | "hub_admin");
      setActive(user.active);
    }
  }, [user]);

  // Save user details
  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/hub-admin/users/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, hub_role: hubRole, active }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hub-admin-user", params.id] });
      queryClient.invalidateQueries({ queryKey: ["hub-admin-users"] });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    },
  });

  // Deactivate user
  const deactivateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/hub-admin/users/${params.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to deactivate");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hub-admin-users"] });
      router.push("/hub-admin/users");
    },
  });

  // Add module
  const addModuleMutation = useMutation({
    mutationFn: async ({
      moduleId,
      moduleRole,
    }: {
      moduleId: ModuleId;
      moduleRole: string;
    }) => {
      const res = await fetch(`/api/hub-admin/users/${params.id}/modules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ module_id: moduleId, module_role: moduleRole }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to add module");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hub-admin-user", params.id] });
      setAddModuleOpen(false);
    },
  });

  // Update module
  const updateModuleMutation = useMutation({
    mutationFn: async ({
      moduleId,
      moduleRole,
      config,
    }: {
      moduleId: string;
      moduleRole?: string;
      config?: Record<string, unknown>;
    }) => {
      const res = await fetch(`/api/hub-admin/users/${params.id}/modules`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          module_id: moduleId,
          module_role: moduleRole,
          config,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to update module");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hub-admin-user", params.id] });
    },
  });

  // Remove module
  const removeModuleMutation = useMutation({
    mutationFn: async (moduleId: string) => {
      const res = await fetch(
        `/api/hub-admin/users/${params.id}/modules?module_id=${moduleId}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to remove module");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hub-admin-user", params.id] });
    },
  });

  // Modules not yet assigned
  const assignedModuleIds = new Set(
    (user?.modules ?? []).map((m) => m.module_id)
  );
  const availableModules = (Object.keys(MODULES) as ModuleId[]).filter(
    (id) => !assignedModuleIds.has(id)
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-[300px] rounded-xl" />
        <Skeleton className="h-[200px] rounded-xl" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="py-16 text-center text-sm text-stone">User not found</div>
    );
  }

  return (
    <div className="space-y-6">
      <Link
        href="/hub-admin/users"
        className="inline-flex items-center gap-1.5 text-sm text-stone transition-colors hover:text-soil"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to users
      </Link>

      {/* User Details */}
      <div className="rounded-xl border border-sand bg-warmwhite p-6">
        <h2 className="mb-4 text-sm font-semibold text-soil">User Details</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-bark">
              Name
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="border-sand bg-white"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-bark">
              Email
            </label>
            <Input
              value={user.email}
              disabled
              className="border-sand bg-sand/30 text-stone"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-bark">
              Auth Provider
            </label>
            <span
              className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                user.auth_provider === "microsoft"
                  ? "bg-blue-50 text-blue-700"
                  : "bg-sand/60 text-bark"
              }`}
            >
              {user.auth_provider === "microsoft" ? "Microsoft" : "Email"}
            </span>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-bark">
              Hub Role
            </label>
            <div className="flex gap-2">
              {(["user", "hub_admin"] as const).map((role) => (
                <button
                  key={role}
                  onClick={() => setHubRole(role)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    hubRole === role
                      ? "bg-forest text-white"
                      : "bg-sand/60 text-bark hover:bg-sand"
                  }`}
                >
                  {role === "hub_admin" ? "Hub Admin" : "User"}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-bark">
              Status
            </label>
            <div className="flex gap-2">
              {([true, false] as const).map((val) => (
                <button
                  key={String(val)}
                  onClick={() => setActive(val)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    active === val
                      ? val
                        ? "bg-canopy text-white"
                        : "bg-blaze text-white"
                      : "bg-sand/60 text-bark hover:bg-sand"
                  }`}
                >
                  {val ? "Active" : "Inactive"}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Button
            size="sm"
            className="bg-canopy text-white hover:bg-canopy/90"
            disabled={saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            <Save className="h-4 w-4" />
            {saveMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
          {saveSuccess && (
            <span className="text-xs text-canopy">Saved successfully</span>
          )}
          {saveMutation.isError && (
            <span className="text-xs text-blaze">
              {saveMutation.error?.message}
            </span>
          )}
        </div>
      </div>

      {/* Module Assignments */}
      <div className="rounded-xl border border-sand bg-warmwhite p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-soil">Module Access</h2>
          {availableModules.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="border-sand text-bark"
              onClick={() => setAddModuleOpen(true)}
            >
              <Plus className="h-4 w-4" />
              Add Module
            </Button>
          )}
        </div>

        {user.modules.length === 0 ? (
          <p className="py-6 text-center text-sm text-stone">
            No module assignments. Click &ldquo;Add Module&rdquo; to assign
            access.
          </p>
        ) : (
          <div className="space-y-4">
            {user.modules.map((mod) => (
              <ModuleCard
                key={mod.id}
                mod={mod}
                growers={growers ?? []}
                onUpdateRole={(role) =>
                  updateModuleMutation.mutate({
                    moduleId: mod.module_id,
                    moduleRole: role,
                  })
                }
                onUpdateConfig={(config) =>
                  updateModuleMutation.mutate({
                    moduleId: mod.module_id,
                    config,
                  })
                }
                onRemove={() => removeModuleMutation.mutate(mod.module_id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Danger Zone */}
      <div className="rounded-xl border border-sand border-l-blaze border-l-4 bg-warmwhite p-6">
        <h2 className="mb-2 text-sm font-semibold text-blaze">Danger Zone</h2>
        <p className="mb-4 text-xs text-stone">
          Deactivating this user will prevent them from logging in and disable
          all module access.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="border-blaze/30 text-blaze hover:bg-blaze/5"
          onClick={() => setDeactivateOpen(true)}
        >
          <Trash2 className="h-4 w-4" />
          Deactivate User
        </Button>
      </div>

      {/* Add Module Dialog */}
      <Dialog open={addModuleOpen} onOpenChange={setAddModuleOpen}>
        <DialogContent className="bg-warmwhite">
          <DialogHeader>
            <DialogTitle className="text-soil">Add Module Access</DialogTitle>
            <DialogDescription className="text-stone">
              Select a module to assign to this user.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {availableModules.map((moduleId) => {
              const mod = MODULES[moduleId];
              const defaultRole = mod.roles[0];
              return (
                <button
                  key={moduleId}
                  className="flex w-full items-center gap-3 rounded-lg border border-sand p-3 text-left transition-colors hover:bg-cream"
                  onClick={() =>
                    addModuleMutation.mutate({
                      moduleId,
                      moduleRole: defaultRole?.role ?? "user",
                    })
                  }
                >
                  <div>
                    <p className="text-sm font-medium text-soil">{mod.name}</p>
                    {defaultRole && (
                      <p className="text-xs text-stone">
                        Default role: {defaultRole.label}
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
            {availableModules.length === 0 && (
              <p className="py-4 text-center text-sm text-stone">
                All modules are already assigned.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Deactivate Confirmation Dialog */}
      <Dialog open={deactivateOpen} onOpenChange={setDeactivateOpen}>
        <DialogContent className="bg-warmwhite">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-blaze">
              <AlertTriangle className="h-5 w-5" />
              Deactivate User
            </DialogTitle>
            <DialogDescription className="text-stone">
              Are you sure you want to deactivate{" "}
              <span className="font-medium text-soil">{user.name}</span>? They
              will no longer be able to log in.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeactivateOpen(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="bg-blaze text-white hover:bg-blaze/90"
              disabled={deactivateMutation.isPending}
              onClick={() => deactivateMutation.mutate()}
            >
              {deactivateMutation.isPending
                ? "Deactivating..."
                : "Deactivate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Module assignment card with role, menu items, capabilities, and grower selector */
function ModuleCard({
  mod,
  growers,
  onUpdateRole,
  onUpdateConfig,
  onRemove,
}: {
  mod: ModuleAccessRow;
  growers: Grower[];
  onUpdateRole: (role: string) => void;
  onUpdateConfig: (config: Record<string, unknown>) => void;
  onRemove: () => void;
}) {
  const moduleDef = MODULES[mod.module_id];
  if (!moduleDef) return null;

  const currentRoleDef = moduleDef.roles.find(
    (r) => r.role === mod.module_role
  );
  const allowedMenuItems =
    (mod.config.allowed_menu_items as string[]) ?? [];
  const capabilities = (mod.config.capabilities as string[]) ?? [];
  const growerId = (mod.config.grower_id as string) ?? "";

  // All possible capabilities from all roles (for display)
  const allCapabilities = new Set<string>();
  for (const role of moduleDef.roles) {
    for (const cap of role.capabilities) {
      allCapabilities.add(cap);
    }
  }

  function toggleMenuItem(itemId: string) {
    const updated = allowedMenuItems.includes(itemId)
      ? allowedMenuItems.filter((i) => i !== itemId)
      : [...allowedMenuItems, itemId];
    onUpdateConfig({
      ...mod.config,
      allowed_menu_items: updated,
    });
  }

  function toggleCapability(cap: string) {
    const updated = capabilities.includes(cap)
      ? capabilities.filter((c) => c !== cap)
      : [...capabilities, cap];
    onUpdateConfig({
      ...mod.config,
      capabilities: updated,
    });
  }

  function handleRoleChange(newRole: string) {
    onUpdateRole(newRole);
    // The API returns defaults; the parent will refetch
  }

  function handleGrowerChange(newGrowerId: string) {
    onUpdateConfig({
      ...mod.config,
      grower_id: newGrowerId || null,
    });
  }

  return (
    <div className="rounded-lg border border-sand p-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-medium text-soil">{moduleDef.name}</h3>
          {currentRoleDef && (
            <p className="text-xs text-stone">{currentRoleDef.description}</p>
          )}
        </div>
        <button
          onClick={onRemove}
          className="text-xs text-blaze transition-colors hover:text-blaze/80"
        >
          Remove
        </button>
      </div>

      {/* Role selector */}
      {moduleDef.roles.length > 0 && (
        <div className="mt-3">
          <label className="mb-1.5 block text-xs font-medium text-bark">
            Role
          </label>
          <div className="flex flex-wrap gap-2">
            {moduleDef.roles.map((roleDef) => (
              <button
                key={roleDef.role}
                onClick={() => handleRoleChange(roleDef.role)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  mod.module_role === roleDef.role
                    ? "bg-forest text-white"
                    : "bg-sand/60 text-bark hover:bg-sand"
                }`}
              >
                {roleDef.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Grower selector (for grower-portal with grower/grower_admin role) */}
      {mod.module_id === "grower-portal" &&
        (mod.module_role === "grower" || mod.module_role === "grower_admin") && (
        <div className="mt-3">
          <label className="mb-1.5 block text-xs font-medium text-bark">
            Grower
          </label>
          <select
            value={growerId}
            onChange={(e) => handleGrowerChange(e.target.value)}
            className="w-full max-w-xs rounded-md border border-sand bg-white px-3 py-1.5 text-sm text-soil focus:outline-none focus:ring-1 focus:ring-forest"
          >
            <option value="">Select a grower...</option>
            {growers.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} ({g.code})
              </option>
            ))}
          </select>
          {mod.module_role === "grower_admin" && (
            <p className="mt-1.5 text-xs text-stone">
              This user will be able to manage grower portal users for this grower.
            </p>
          )}
        </div>
      )}

      {/* Menu items checkboxes */}
      {moduleDef.menuItems.length > 0 && (
        <div className="mt-3">
          <label className="mb-1.5 block text-xs font-medium text-bark">
            Allowed Menu Items
          </label>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {moduleDef.menuItems.map((item) => (
              <label
                key={item.id}
                className="flex items-center gap-1.5 text-xs text-bark"
              >
                <input
                  type="checkbox"
                  checked={allowedMenuItems.includes(item.id)}
                  onChange={() => toggleMenuItem(item.id)}
                  className="h-3.5 w-3.5 rounded border-sand text-forest focus:ring-forest"
                />
                {item.label}
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Capabilities checkboxes */}
      {allCapabilities.size > 0 && (
        <div className="mt-3">
          <label className="mb-1.5 block text-xs font-medium text-bark">
            Capabilities
          </label>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {Array.from(allCapabilities).map((cap) => (
              <label
                key={cap}
                className="flex items-center gap-1.5 text-xs text-bark"
              >
                <input
                  type="checkbox"
                  checked={capabilities.includes(cap)}
                  onChange={() => toggleCapability(cap)}
                  className="h-3.5 w-3.5 rounded border-sand text-forest focus:ring-forest"
                />
                {cap.replace(/_/g, " ")}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
