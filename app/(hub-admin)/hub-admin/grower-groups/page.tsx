"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Search, Plus, Pencil } from "lucide-react";

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
import { safeFetch } from "@/lib/portal-constants";

interface GrowerGroupRow {
  id: string;
  name: string;
  code: string | null;
  abn: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  address: string | null;
  active: boolean;
  grower_count: number;
}

export default function GrowerGroupsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCode, setNewCode] = useState("");
  const [newAbn, setNewAbn] = useState("");
  const [newContactName, setNewContactName] = useState("");
  const [newContactEmail, setNewContactEmail] = useState("");
  const [newContactPhone, setNewContactPhone] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(value), 300);
  }, []);

  // Clean up debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const queryParams = debouncedSearch.trim()
    ? `?search=${encodeURIComponent(debouncedSearch.trim())}`
    : "";

  const { data, isLoading } = useQuery<GrowerGroupRow[]>({
    queryKey: ["hub-admin-grower-groups", queryParams],
    queryFn: () =>
      safeFetch<GrowerGroupRow[]>(`/api/hub-admin/grower-groups${queryParams}`
      ),
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/hub-admin/grower-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName,
          code: newCode || undefined,
          abn: newAbn || undefined,
          contact_name: newContactName || undefined,
          contact_email: newContactEmail || undefined,
          contact_phone: newContactPhone || undefined,
          address: newAddress || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create grower group");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["hub-admin-grower-groups"],
      });
      setAddOpen(false);
      setNewName("");
      setNewCode("");
      setNewAbn("");
      setNewContactName("");
      setNewContactEmail("");
      setNewContactPhone("");
      setNewAddress("");
    },
  });

  const groups = data ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-soil">Grower Groups</h1>
        <Button
          size="sm"
          className="bg-canopy text-white hover:bg-canopy/90"
          onClick={() => setAddOpen(true)}
        >
          <Plus className="h-4 w-4" />
          Add Group
        </Button>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone" />
        <Input
          placeholder="Search by name or code..."
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="pl-9 border-sand bg-warmwhite"
        />
      </div>

      {/* Table */}
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
                <TableHead className="text-xs text-stone">Code</TableHead>
                <TableHead className="text-xs text-stone">ABN</TableHead>
                <TableHead className="text-xs text-stone">Contact</TableHead>
                <TableHead className="text-xs text-stone">Growers</TableHead>
                <TableHead className="text-xs text-stone">Status</TableHead>
                <TableHead className="text-xs text-stone w-[60px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="py-8 text-center text-sm text-stone"
                  >
                    No grower groups found
                  </TableCell>
                </TableRow>
              ) : (
                groups.map((group) => (
                  <TableRow
                    key={group.id}
                    className="cursor-pointer border-sand/50"
                    onClick={() =>
                      router.push(`/hub-admin/grower-groups/${group.id}`)
                    }
                  >
                    <TableCell className="font-medium text-soil">
                      {group.name}
                    </TableCell>
                    <TableCell className="text-bark">
                      {group.code ?? (
                        <span className="text-stone">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-bark">
                      {group.abn ?? (
                        <span className="text-stone">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-bark">
                      {group.contact_name ?? (
                        <span className="text-stone">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex rounded-full bg-forest/10 px-2 py-0.5 text-xs font-medium text-forest">
                        {group.grower_count}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          group.active
                            ? "bg-canopy/10 text-canopy"
                            : "bg-blaze/10 text-blaze"
                        }`}
                      >
                        {group.active ? "Active" : "Inactive"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push(
                            `/hub-admin/grower-groups/${group.id}`
                          );
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

      {/* Add Group Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="bg-warmwhite sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-soil">Add Grower Group</DialogTitle>
            <DialogDescription className="text-stone">
              Create a new grower group to organise growers under a single
              entity.
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
                placeholder="Group name"
                className="border-sand bg-white"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-bark">
                  Code
                </label>
                <Input
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value)}
                  placeholder="e.g. GRP001"
                  className="border-sand bg-white"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-bark">
                  ABN
                </label>
                <Input
                  value={newAbn}
                  onChange={(e) => setNewAbn(e.target.value)}
                  placeholder="Australian Business Number"
                  className="border-sand bg-white"
                />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-bark">
                Contact Name
              </label>
              <Input
                value={newContactName}
                onChange={(e) => setNewContactName(e.target.value)}
                placeholder="Primary contact"
                className="border-sand bg-white"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-bark">
                  Contact Email
                </label>
                <Input
                  type="email"
                  value={newContactEmail}
                  onChange={(e) => setNewContactEmail(e.target.value)}
                  placeholder="email@example.com"
                  className="border-sand bg-white"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-bark">
                  Contact Phone
                </label>
                <Input
                  value={newContactPhone}
                  onChange={(e) => setNewContactPhone(e.target.value)}
                  placeholder="Phone number"
                  className="border-sand bg-white"
                />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-bark">
                Address
              </label>
              <Input
                value={newAddress}
                onChange={(e) => setNewAddress(e.target.value)}
                placeholder="Business address"
                className="border-sand bg-white"
              />
            </div>
          </div>

          {createMutation.isError && (
            <p className="text-xs text-blaze">
              {createMutation.error?.message ?? "Failed to create group"}
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
              disabled={!newName.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? "Creating..." : "Create Group"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
