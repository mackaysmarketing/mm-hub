"use client";

import { useState, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Search, UserPlus, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
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

interface ModuleAccess {
  id: string;
  module_id: ModuleId;
  module_role: string;
  config: Record<string, unknown>;
  active: boolean;
}

interface HubUserRow {
  id: string;
  name: string;
  email: string;
  auth_provider: string;
  hub_role: string;
  active: boolean;
  last_login_at: string | null;
  created_at: string;
  modules: ModuleAccess[];
}

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  const diffMo = Math.floor(diffDay / 30);
  return `${diffMo}mo ago`;
}

export default function UsersPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"user" | "hub_admin">("user");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(value), 300);
  }, []);

  const queryParams = debouncedSearch.trim()
    ? `?search=${encodeURIComponent(debouncedSearch.trim())}`
    : "";

  const { data, isLoading } = useQuery<{ users: HubUserRow[] }>({
    queryKey: ["hub-admin-users", queryParams],
    queryFn: () =>
      fetch(`/api/hub-admin/users${queryParams}`).then((r) => r.json()),
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/hub-admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName,
          email: newEmail,
          password: newPassword,
          hub_role: newRole,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create user");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hub-admin-users"] });
      setAddOpen(false);
      setNewName("");
      setNewEmail("");
      setNewPassword("");
      setNewRole("user");
    },
  });

  const users = data?.users ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-soil">User Management</h1>
        <Button
          size="sm"
          className="bg-canopy text-white hover:bg-canopy/90"
          onClick={() => setAddOpen(true)}
        >
          <UserPlus className="h-4 w-4" />
          Add User
        </Button>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone" />
        <Input
          placeholder="Search by name or email..."
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="pl-9 border-sand bg-warmwhite"
        />
      </div>

      {/* Users table */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-sand bg-warmwhite">
          <Table>
            <TableHeader>
              <TableRow className="border-sand hover:bg-transparent">
                <TableHead className="text-xs text-stone">Name</TableHead>
                <TableHead className="text-xs text-stone">Email</TableHead>
                <TableHead className="text-xs text-stone">Auth</TableHead>
                <TableHead className="text-xs text-stone">Hub Role</TableHead>
                <TableHead className="text-xs text-stone">Modules</TableHead>
                <TableHead className="text-xs text-stone">Status</TableHead>
                <TableHead className="text-xs text-stone">Last Login</TableHead>
                <TableHead className="text-xs text-stone w-[60px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="py-8 text-center text-sm text-stone"
                  >
                    No users found
                  </TableCell>
                </TableRow>
              ) : (
                users.map((user) => (
                  <TableRow
                    key={user.id}
                    className="cursor-pointer border-sand/50"
                    onClick={() =>
                      router.push(`/hub-admin/users/${user.id}`)
                    }
                  >
                    <TableCell className="font-medium text-soil">
                      {user.name}
                    </TableCell>
                    <TableCell className="text-bark">{user.email}</TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          user.auth_provider === "microsoft"
                            ? "bg-blue-50 text-blue-700"
                            : "bg-sand/60 text-bark"
                        }`}
                      >
                        {user.auth_provider === "microsoft"
                          ? "Microsoft"
                          : "Email"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          user.hub_role === "hub_admin"
                            ? "bg-canopy/10 text-canopy"
                            : "bg-cream text-bark"
                        }`}
                      >
                        {user.hub_role === "hub_admin" ? "Hub Admin" : "User"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {user.modules
                          .filter((m) => m.active)
                          .map((m) => (
                            <span
                              key={m.id}
                              className="inline-flex rounded bg-forest/10 px-1.5 py-0.5 text-xs text-forest"
                            >
                              {MODULES[m.module_id]?.name ?? m.module_id}
                            </span>
                          ))}
                        {user.modules.filter((m) => m.active).length === 0 && (
                          <span className="text-xs text-stone">None</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          user.active
                            ? "bg-canopy/10 text-canopy"
                            : "bg-blaze/10 text-blaze"
                        }`}
                      >
                        {user.active ? "Active" : "Inactive"}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-stone">
                      {relativeTime(user.last_login_at)}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push(`/hub-admin/users/${user.id}`);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5 text-stone" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Add User Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="bg-warmwhite">
          <DialogHeader>
            <DialogTitle className="text-soil">Add User</DialogTitle>
            <DialogDescription className="text-stone">
              Create a new user account with email/password authentication.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-bark">
                Name *
              </label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Full name"
                className="border-sand bg-white"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-bark">
                Email *
              </label>
              <Input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="user@example.com"
                className="border-sand bg-white"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-bark">
                Password *
              </label>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Minimum 6 characters"
                className="border-sand bg-white"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-bark">
                Hub Role
              </label>
              <div className="flex gap-2">
                {(["user", "hub_admin"] as const).map((role) => (
                  <button
                    key={role}
                    onClick={() => setNewRole(role)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                      newRole === role
                        ? "bg-forest text-white"
                        : "bg-sand/60 text-bark hover:bg-sand"
                    }`}
                  >
                    {role === "hub_admin" ? "Hub Admin" : "User"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {createMutation.isError && (
            <p className="text-xs text-blaze">
              {createMutation.error?.message ?? "Failed to create user"}
            </p>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAddOpen(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="bg-canopy text-white hover:bg-canopy/90"
              disabled={
                !newName.trim() ||
                !newEmail.trim() ||
                !newPassword.trim() ||
                createMutation.isPending
              }
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? "Creating..." : "Create User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
