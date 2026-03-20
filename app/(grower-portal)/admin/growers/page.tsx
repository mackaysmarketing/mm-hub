"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { UserPlus, Pencil } from "lucide-react";

import { TopBar } from "@/components/top-bar";
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

interface Grower {
  id: string;
  name: string;
  code: string;
  freshtrack_code: string | null;
  abn: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  active: boolean;
}

const EMPTY_FORM = {
  name: "",
  code: "",
  freshtrack_code: "",
  abn: "",
  address: "",
  email: "",
  phone: "",
  active: true,
};

export default function GrowerManagementPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const { data: growers, isLoading } = useQuery<Grower[]>({
    queryKey: ["admin-growers"],
    queryFn: () =>
      fetch("/api/grower-portal/admin/growers").then((r) => r.json()),
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const url = editingId
        ? `/api/grower-portal/admin/growers/${editingId}`
        : "/api/grower-portal/admin/growers";
      const res = await fetch(url, {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-growers"] });
      closeDialog();
    },
  });

  function openAdd() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEdit(grower: Grower) {
    setEditingId(grower.id);
    setForm({
      name: grower.name,
      code: grower.code,
      freshtrack_code: grower.freshtrack_code ?? "",
      abn: grower.abn ?? "",
      address: grower.address ?? "",
      email: grower.email ?? "",
      phone: grower.phone ?? "",
      active: grower.active,
    });
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  function updateField(field: string, value: string | boolean) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  return (
    <div className="space-y-6">
      <TopBar title="Grower Management">
        <Button
          size="sm"
          className="bg-canopy text-white hover:bg-canopy/90"
          onClick={openAdd}
        >
          <UserPlus className="h-4 w-4" />
          Add Grower
        </Button>
      </TopBar>

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
                <TableHead className="text-xs text-stone">FreshTrack Code</TableHead>
                <TableHead className="text-xs text-stone">ABN</TableHead>
                <TableHead className="text-xs text-stone">Email</TableHead>
                <TableHead className="text-xs text-stone">Status</TableHead>
                <TableHead className="text-xs text-stone w-[60px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(growers ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-sm text-stone">
                    No growers found
                  </TableCell>
                </TableRow>
              ) : (
                (growers ?? []).map((g) => (
                  <TableRow
                    key={g.id}
                    className="cursor-pointer border-sand/50"
                    onClick={() => openEdit(g)}
                  >
                    <TableCell className="font-medium text-soil">{g.name}</TableCell>
                    <TableCell className="font-mono text-xs text-bark">{g.code}</TableCell>
                    <TableCell className="font-mono text-xs text-bark">
                      {g.freshtrack_code ?? <span className="text-stone">—</span>}
                    </TableCell>
                    <TableCell className="text-xs text-bark">{g.abn ?? "—"}</TableCell>
                    <TableCell className="text-xs text-bark">{g.email ?? "—"}</TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          g.active
                            ? "bg-canopy/10 text-canopy"
                            : "bg-blaze/10 text-blaze"
                        }`}
                      >
                        {g.active ? "Active" : "Inactive"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={(e) => {
                          e.stopPropagation();
                          openEdit(g);
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

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="bg-warmwhite sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-soil">
              {editingId ? "Edit Grower" : "Add Grower"}
            </DialogTitle>
            <DialogDescription className="text-stone">
              {editingId
                ? "Update grower details."
                : "Create a new grower record."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-bark">
                  Name *
                </label>
                <Input
                  value={form.name}
                  onChange={(e) => updateField("name", e.target.value)}
                  className="border-sand bg-white"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-bark">
                  Code *
                </label>
                <Input
                  value={form.code}
                  onChange={(e) => updateField("code", e.target.value)}
                  className="border-sand bg-white"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-bark">
                FreshTrack Code
              </label>
              <Input
                value={form.freshtrack_code}
                onChange={(e) => updateField("freshtrack_code", e.target.value)}
                placeholder="e.g. GRW001"
                className="border-sand bg-white"
              />
              <p className="mt-1 text-[11px] text-stone">
                Must match the entity code in FreshTrack for data sync to work
              </p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-bark">
                ABN
              </label>
              <Input
                value={form.abn}
                onChange={(e) => updateField("abn", e.target.value)}
                className="border-sand bg-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-bark">
                Address
              </label>
              <Input
                value={form.address}
                onChange={(e) => updateField("address", e.target.value)}
                className="border-sand bg-white"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-bark">
                  Email
                </label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => updateField("email", e.target.value)}
                  className="border-sand bg-white"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-bark">
                  Phone
                </label>
                <Input
                  value={form.phone}
                  onChange={(e) => updateField("phone", e.target.value)}
                  className="border-sand bg-white"
                />
              </div>
            </div>
            {editingId && (
              <div>
                <label className="mb-1.5 block text-xs font-medium text-bark">
                  Status
                </label>
                <div className="flex gap-2">
                  {([true, false] as const).map((val) => (
                    <button
                      key={String(val)}
                      onClick={() => updateField("active", val)}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                        form.active === val
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
            )}
          </div>

          {saveMutation.isError && (
            <p className="text-xs text-blaze">
              {saveMutation.error?.message ?? "Failed to save"}
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={closeDialog}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="bg-canopy text-white hover:bg-canopy/90"
              disabled={!form.name.trim() || !form.code.trim() || saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? "Saving..." : editingId ? "Save Changes" : "Create Grower"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
