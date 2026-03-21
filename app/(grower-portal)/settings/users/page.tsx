"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Users,
  Eye,
  EyeOff,
  UserCog,
} from "lucide-react";

import { TopBar } from "@/components/top-bar";
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

interface GrowerUser {
  user_id: string;
  name: string;
  email: string;
  auth_provider: string;
  module_role: string;
  grower_ids: string[] | null;
  allowed_menu_items: string[];
  financial_access: Record<string, boolean>;
  capabilities: string[];
  active: boolean;
  user_active: boolean;
  created_at: string;
}

interface GrowerInfo {
  id: string;
  name: string;
  region: string | null;
}

const MENU_ITEMS = MODULES["grower-portal"].menuItems.map((m) => ({
  id: m.id,
  label: m.label,
}));

export default function GrowerUsersPage() {
  const queryClient = useQueryClient();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editUser, setEditUser] = useState<GrowerUser | null>(null);

  const { data: users, isLoading } = useQuery<GrowerUser[]>({
    queryKey: ["grower-admin-users"],
    queryFn: () =>
      fetch("/api/grower-portal/admin/users").then((r) => r.json()),
  });

  const { data: growers } = useQuery<GrowerInfo[]>({
    queryKey: ["grower-admin-growers"],
    queryFn: () =>
      fetch("/api/grower-portal/admin/growers").then((r) => r.json()),
  });

  return (
    <div className="space-y-6">
      <TopBar title="User Management">
        <Button
          size="sm"
          className="bg-canopy text-white hover:bg-canopy/90"
          onClick={() => setAddDialogOpen(true)}
        >
          <Plus className="h-4 w-4" />
          Add User
        </Button>
      </TopBar>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-sand bg-warmwhite">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-sand text-xs text-stone">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Grower Access</th>
                  <th className="px-4 py-3 font-medium">Menu Access</th>
                  <th className="px-4 py-3 font-medium">Financials</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(users ?? []).map((user) => (
                  <tr
                    key={user.user_id}
                    className="border-b border-sand/50 last:border-0"
                  >
                    <td className="px-4 py-3 font-medium text-soil">
                      {user.name}
                    </td>
                    <td className="px-4 py-3 text-bark">{user.email}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {user.grower_ids === null ? (
                          <span className="rounded-full bg-canopy/10 px-2 py-0.5 text-xs text-canopy">
                            All growers
                          </span>
                        ) : (
                          user.grower_ids.map((growerId) => {
                            const grower = (growers ?? []).find(
                              (g) => g.id === growerId
                            );
                            return (
                              <span
                                key={growerId}
                                className="rounded-full bg-sand/60 px-2 py-0.5 text-xs text-bark"
                              >
                                {grower?.name ?? growerId.slice(0, 8)}
                              </span>
                            );
                          })
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-bark">
                      {user.allowed_menu_items.length} items
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {MENU_ITEMS.filter((m) =>
                          user.allowed_menu_items.includes(m.id)
                        ).map((m) => (
                          <span key={m.id} title={m.label}>
                            {user.financial_access[m.id] !== false ? (
                              <Eye className="h-3.5 w-3.5 text-canopy" />
                            ) : (
                              <EyeOff className="h-3.5 w-3.5 text-stone" />
                            )}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          user.active
                            ? "bg-canopy/10 text-canopy"
                            : "bg-blaze/10 text-blaze"
                        }`}
                      >
                        {user.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setEditUser(user)}
                        className="text-xs text-forest transition hover:text-forest/80"
                      >
                        <UserCog className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {(users ?? []).length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-8 text-center text-sm text-stone"
                    >
                      <Users className="mx-auto mb-2 h-8 w-8 text-sand" />
                      No users yet. Click &ldquo;Add User&rdquo; to create one.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add User Dialog */}
      <AddUserDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        growers={growers ?? []}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["grower-admin-users"] });
          setAddDialogOpen(false);
        }}
      />

      {/* Edit User Dialog */}
      {editUser && (
        <EditUserDialog
          open={!!editUser}
          onOpenChange={(open) => !open && setEditUser(null)}
          user={editUser}
          growers={growers ?? []}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ["grower-admin-users"] });
            setEditUser(null);
          }}
        />
      )}
    </div>
  );
}

function AddUserDialog({
  open,
  onOpenChange,
  growers,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  growers: GrowerInfo[];
  onSuccess: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [allGrowers, setAllGrowers] = useState(true);
  const [selectedGrowerIds, setSelectedGrowerIds] = useState<string[]>([]);
  const [menuItems, setMenuItems] = useState<string[]>(
    MENU_ITEMS.map((m) => m.id)
  );
  const [financialAccess, setFinancialAccess] = useState<
    Record<string, boolean>
  >(
    Object.fromEntries(MENU_ITEMS.map((m) => [m.id, false]))
  );

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/grower-portal/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          password,
          grower_ids: allGrowers ? null : selectedGrowerIds,
          allowed_menu_items: menuItems,
          financial_access: financialAccess,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create user");
      }
      return res.json();
    },
    onSuccess: () => {
      setName("");
      setEmail("");
      setPassword("");
      setAllGrowers(true);
      setSelectedGrowerIds([]);
      onSuccess();
    },
  });

  function toggleGrower(growerId: string) {
    setSelectedGrowerIds((prev) =>
      prev.includes(growerId)
        ? prev.filter((id) => id !== growerId)
        : [...prev, growerId]
    );
  }

  function toggleMenuItem(itemId: string) {
    setMenuItems((prev) =>
      prev.includes(itemId)
        ? prev.filter((id) => id !== itemId)
        : [...prev, itemId]
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto bg-warmwhite sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-soil">Add User</DialogTitle>
          <DialogDescription className="text-stone">
            Create a new user for your grower portal.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-bark">
              Name
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="border-sand bg-white"
              placeholder="Full name"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-bark">
              Email
            </label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="border-sand bg-white"
              placeholder="user@example.com"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-bark">
              Password
            </label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="border-sand bg-white"
              placeholder="Minimum 8 characters"
            />
          </div>

          {/* Grower access */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-bark">
              Grower Access
            </label>
            <label className="mb-2 flex items-center gap-2 text-sm text-bark">
              <input
                type="checkbox"
                checked={allGrowers}
                onChange={() => setAllGrowers(!allGrowers)}
                className="h-4 w-4 rounded border-sand text-forest"
              />
              All growers
            </label>
            {!allGrowers && (
              <div className="ml-6 space-y-1.5">
                {growers.map((grower) => (
                  <label
                    key={grower.id}
                    className="flex items-center gap-2 text-sm text-bark"
                  >
                    <input
                      type="checkbox"
                      checked={selectedGrowerIds.includes(grower.id)}
                      onChange={() => toggleGrower(grower.id)}
                      className="h-3.5 w-3.5 rounded border-sand text-forest"
                    />
                    {grower.name}
                    {grower.region && (
                      <span className="text-xs text-stone">
                        — {grower.region}
                      </span>
                    )}
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Menu items */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-bark">
              Menu Items
            </label>
            <div className="space-y-1.5">
              {MENU_ITEMS.map((item) => (
                <div key={item.id} className="flex items-center gap-3">
                  <label className="flex flex-1 items-center gap-2 text-sm text-bark">
                    <input
                      type="checkbox"
                      checked={menuItems.includes(item.id)}
                      onChange={() => toggleMenuItem(item.id)}
                      className="h-3.5 w-3.5 rounded border-sand text-forest"
                    />
                    {item.label}
                  </label>
                  {menuItems.includes(item.id) && (
                    <label className="flex items-center gap-1.5 text-xs text-stone">
                      <input
                        type="checkbox"
                        checked={financialAccess[item.id] !== false}
                        onChange={() =>
                          setFinancialAccess((prev) => ({
                            ...prev,
                            [item.id]: !prev[item.id],
                          }))
                        }
                        className="h-3 w-3 rounded border-sand text-forest"
                      />
                      Show $
                    </label>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="bg-canopy text-white hover:bg-canopy/90"
            disabled={mutation.isPending || !name || !email || !password}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "Creating..." : "Create User"}
          </Button>
        </DialogFooter>
        {mutation.isError && (
          <p className="text-xs text-blaze">{mutation.error?.message}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditUserDialog({
  open,
  onOpenChange,
  user,
  growers,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: GrowerUser;
  growers: GrowerInfo[];
  onSuccess: () => void;
}) {
  const [allGrowers, setAllGrowers] = useState(user.grower_ids === null);
  const [selectedGrowerIds, setSelectedGrowerIds] = useState<string[]>(
    user.grower_ids ?? []
  );
  const [menuItems, setMenuItems] = useState<string[]>(
    user.allowed_menu_items
  );
  const [financialAccess, setFinancialAccess] = useState<
    Record<string, boolean>
  >(user.financial_access);

  const updateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/grower-portal/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: user.user_id,
          grower_ids: allGrowers ? null : selectedGrowerIds,
          allowed_menu_items: menuItems,
          financial_access: financialAccess,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to update");
      }
      return res.json();
    },
    onSuccess,
  });

  const deactivateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `/api/grower-portal/admin/users?user_id=${user.user_id}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to deactivate");
      }
      return res.json();
    },
    onSuccess,
  });

  function toggleGrower(growerId: string) {
    setSelectedGrowerIds((prev) =>
      prev.includes(growerId)
        ? prev.filter((id) => id !== growerId)
        : [...prev, growerId]
    );
  }

  function toggleMenuItem(itemId: string) {
    setMenuItems((prev) =>
      prev.includes(itemId)
        ? prev.filter((id) => id !== itemId)
        : [...prev, itemId]
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto bg-warmwhite sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-soil">Edit User — {user.name}</DialogTitle>
          <DialogDescription className="text-stone">
            {user.email}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Grower access */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-bark">
              Grower Access
            </label>
            <label className="mb-2 flex items-center gap-2 text-sm text-bark">
              <input
                type="checkbox"
                checked={allGrowers}
                onChange={() => setAllGrowers(!allGrowers)}
                className="h-4 w-4 rounded border-sand text-forest"
              />
              All growers
            </label>
            {!allGrowers && (
              <div className="ml-6 space-y-1.5">
                {growers.map((grower) => (
                  <label
                    key={grower.id}
                    className="flex items-center gap-2 text-sm text-bark"
                  >
                    <input
                      type="checkbox"
                      checked={selectedGrowerIds.includes(grower.id)}
                      onChange={() => toggleGrower(grower.id)}
                      className="h-3.5 w-3.5 rounded border-sand text-forest"
                    />
                    {grower.name}
                    {grower.region && (
                      <span className="text-xs text-stone">
                        — {grower.region}
                      </span>
                    )}
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Menu items */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-bark">
              Menu Items
            </label>
            <div className="space-y-1.5">
              {MENU_ITEMS.map((item) => (
                <div key={item.id} className="flex items-center gap-3">
                  <label className="flex flex-1 items-center gap-2 text-sm text-bark">
                    <input
                      type="checkbox"
                      checked={menuItems.includes(item.id)}
                      onChange={() => toggleMenuItem(item.id)}
                      className="h-3.5 w-3.5 rounded border-sand text-forest"
                    />
                    {item.label}
                  </label>
                  {menuItems.includes(item.id) && (
                    <label className="flex items-center gap-1.5 text-xs text-stone">
                      <input
                        type="checkbox"
                        checked={financialAccess[item.id] !== false}
                        onChange={() =>
                          setFinancialAccess((prev) => ({
                            ...prev,
                            [item.id]: !prev[item.id],
                          }))
                        }
                        className="h-3 w-3 rounded border-sand text-forest"
                      />
                      Show $
                    </label>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          {user.active && (
            <Button
              variant="outline"
              size="sm"
              className="border-blaze/30 text-blaze hover:bg-blaze/5"
              disabled={deactivateMutation.isPending}
              onClick={() => deactivateMutation.mutate()}
            >
              {deactivateMutation.isPending ? "Deactivating..." : "Deactivate"}
            </Button>
          )}
          <div className="flex-1" />
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="bg-canopy text-white hover:bg-canopy/90"
            disabled={updateMutation.isPending}
            onClick={() => updateMutation.mutate()}
          >
            {updateMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
        {updateMutation.isError && (
          <p className="text-xs text-blaze">{updateMutation.error?.message}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
