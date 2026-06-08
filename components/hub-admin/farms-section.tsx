"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import type { RctiRecipient } from "./rcti-recipients-section";

interface Farm {
  id: string;
  name: string;
  code: string | null;
  freshtrack_code: string | null;
  abn: string | null;
  active: boolean;
  rcti_recipient_id: string | null;
  rcti_recipients: { name: string } | null;
}

export function FarmsSection({ groupId }: { groupId: string }) {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Farm | null>(null);
  const [deleting, setDeleting] = useState<Farm | null>(null);

  const deleteFarm = useMutation({
    mutationFn: async (farm: Farm) => {
      const res = await fetch(`/api/hub-admin/farms/${farm.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Delete failed");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hub-admin-farms", groupId] });
      setDeleting(null);
    },
  });

  const { data: farms, isLoading } = useQuery<Farm[]>({
    queryKey: ["hub-admin-farms", groupId],
    queryFn: () =>
      fetch(`/api/hub-admin/grower-groups/${groupId}/farms`).then((r) => {
        if (!r.ok) throw new Error("Failed to load farms");
        return r.json();
      }),
  });

  const { data: recipients } = useQuery<RctiRecipient[]>({
    queryKey: ["hub-admin-rcti-recipients", groupId],
    queryFn: () =>
      fetch(`/api/hub-admin/rcti-recipients?groupId=${groupId}`).then((r) => {
        if (!r.ok) throw new Error("Failed to load recipients");
        return r.json();
      }),
  });

  return (
    <div className="space-y-4 rounded-xl border border-sand bg-warmwhite p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-soil">
            Farms{" "}
            <span className="ml-1 text-xs font-normal text-stone">
              ({farms?.length ?? 0})
            </span>
          </h2>
          <p className="mt-0.5 text-xs text-stone">
            The production axis — FreshTrack entities. Each farm is paid by an RCTI recipient (many farms can share one).
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="border-sand"
          onClick={() => setAddOpen(true)}
        >
          <Plus className="h-4 w-4" />
          Add Farm
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-stone">Loading…</p>
      ) : (farms ?? []).length === 0 ? (
        <p className="text-sm text-stone">
          No farms assigned to this group yet.
        </p>
      ) : (
        <div className="rounded-lg border border-sand/60">
          <Table>
            <TableHeader>
              <TableRow className="border-sand hover:bg-transparent">
                <TableHead className="text-xs text-stone">Name</TableHead>
                <TableHead className="text-xs text-stone">Code</TableHead>
                <TableHead className="text-xs text-stone">FreshTrack</TableHead>
                <TableHead className="text-xs text-stone">Paid by</TableHead>
                <TableHead className="text-xs text-stone">Status</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(farms ?? []).map((f) => (
                <TableRow key={f.id} className="border-sand/50">
                  <TableCell className="font-medium text-soil">{f.name}</TableCell>
                  <TableCell className="text-bark">
                    {f.code ?? <span className="text-stone">—</span>}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-bark">
                    {f.freshtrack_code ?? <span className="text-stone">—</span>}
                  </TableCell>
                  <TableCell className="text-bark">
                    {f.rcti_recipients?.name ?? (
                      <span className="text-stone">Unassigned</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        f.active
                          ? "bg-canopy/10 text-canopy"
                          : "bg-blaze/10 text-blaze"
                      }`}
                    >
                      {f.active ? "Active" : "Inactive"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-0.5">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title="Edit"
                        onClick={() => setEditing(f)}
                      >
                        <Pencil className="h-3.5 w-3.5 text-stone" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title="Delete"
                        onClick={() => setDeleting(f)}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-blaze/70" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <FarmDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        groupId={groupId}
        recipients={recipients ?? []}
        onSaved={() =>
          qc.invalidateQueries({ queryKey: ["hub-admin-farms", groupId] })
        }
      />
      <FarmDialog
        open={!!editing}
        onClose={() => setEditing(null)}
        groupId={groupId}
        recipients={recipients ?? []}
        farm={editing}
        onSaved={() =>
          qc.invalidateQueries({ queryKey: ["hub-admin-farms", groupId] })
        }
      />

      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="bg-warmwhite">
          <DialogHeader>
            <DialogTitle className="text-blaze">Delete farm?</DialogTitle>
            <DialogDescription className="text-stone">
              Refused automatically if any synced records (consignments / dispatch
              / QA / documents) reference this farm. Deactivate instead to keep
              the history.
            </DialogDescription>
          </DialogHeader>
          {deleting && (
            <div className="rounded-md bg-sand/30 p-3 text-xs text-bark">
              <p className="font-medium">{deleting.name}</p>
              {deleting.freshtrack_code && (
                <p className="mt-1 font-mono text-stone">
                  FreshTrack: {deleting.freshtrack_code}
                </p>
              )}
            </div>
          )}
          {deleteFarm.isError && (
            <p className="text-xs text-blaze">{deleteFarm.error?.message}</p>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="bg-blaze text-white hover:bg-blaze/90"
              disabled={deleteFarm.isPending}
              onClick={() => deleting && deleteFarm.mutate(deleting)}
            >
              <Trash2 className="h-4 w-4" />
              {deleteFarm.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface CatalogueRow {
  freshtrack_id: string;
  code: string | null;
  name: string | null;
  classification: string | null;
  parent_code: string | null;
  parent_name: string | null;
  abn: string | null;
}

function FarmDialog({
  open,
  onClose,
  groupId,
  recipients,
  farm,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  groupId: string;
  recipients: RctiRecipient[];
  farm?: Farm | null;
  onSaved: () => void;
}) {
  const isEdit = !!farm;
  const [mode, setMode] = useState<"catalogue" | "manual">("catalogue");
  const [catalogueQuery, setCatalogueQuery] = useState("");
  const [pickedCatalogueId, setPickedCatalogueId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [freshtrackCode, setFreshtrackCode] = useState("");
  const [abn, setAbn] = useState("");
  const [recipientId, setRecipientId] = useState("");
  const [active, setActive] = useState(true);

  // Catalogue search (only when in catalogue mode + creating, not editing).
  const { data: catalogue, isLoading: catalogueLoading } = useQuery<CatalogueRow[]>({
    queryKey: ["ft-catalogue-farms", catalogueQuery],
    queryFn: () => {
      const p = new URLSearchParams();
      p.set("type", "farm");
      p.set("excludeProvisioned", "true");
      if (catalogueQuery.trim()) p.set("search", catalogueQuery.trim());
      return fetch(`/api/hub-admin/freshtrack-catalogue?${p.toString()}`).then((r) => {
        if (!r.ok) throw new Error("Failed to load FreshTrack catalogue");
        return r.json();
      });
    },
    enabled: open && !isEdit && mode === "catalogue",
  });

  // Seed/reset on open
  useEffect(() => {
    if (!open) return;
    setMode(isEdit ? "manual" : "catalogue");
    setCatalogueQuery("");
    setPickedCatalogueId(null);
    if (farm) {
      setName(farm.name);
      setCode(farm.code ?? "");
      setFreshtrackCode(farm.freshtrack_code ?? "");
      setAbn(farm.abn ?? "");
      setRecipientId(farm.rcti_recipient_id ?? "");
      setActive(farm.active);
    } else {
      setName("");
      setCode("");
      setFreshtrackCode("");
      setAbn("");
      setRecipientId("");
      setActive(true);
    }
  }, [open, farm, isEdit]);

  function pickCatalogueRow(row: CatalogueRow) {
    setPickedCatalogueId(row.freshtrack_id);
    setName(row.name ?? "");
    setCode(row.code ?? "");
    setFreshtrackCode(row.code ?? "");
    setAbn(row.abn ?? "");
    // If the catalogue parent exists as an rcti_recipient in this group with
    // a matching freshtrack_code, pre-pick that recipient too. Best-effort —
    // user can adjust.
    if (row.parent_code) {
      const candidate = recipients.find((r) => r.netsuite_entity_code === row.parent_code);
      if (candidate) setRecipientId(candidate.id);
    }
  }

  const save = useMutation({
    mutationFn: async () => {
      if (isEdit && farm) {
        const body: Record<string, unknown> = {
          name,
          code: code || null,
          freshtrack_code: freshtrackCode || null,
          abn: abn || null,
          active,
          rcti_recipient_id: recipientId || null,
        };
        const res = await fetch(`/api/hub-admin/farms/${farm.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error ?? "Save failed");
        }
        return res.json();
      }
      const res = await fetch(`/api/hub-admin/grower-groups/${groupId}/farms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          code,
          freshtrack_code: freshtrackCode || null,
          abn: abn || null,
          rcti_recipient_id: recipientId || null,
          ...(mode === "catalogue" && pickedCatalogueId
            ? { freshtrack_entity_uuid: pickedCatalogueId }
            : {}),
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Save failed");
      }
      return res.json();
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-warmwhite">
        <DialogHeader>
          <DialogTitle className="text-soil">
            {isEdit ? "Edit farm" : "Add farm"}
          </DialogTitle>
        </DialogHeader>

        {/* Mode tabs — only for create */}
        {!isEdit && (
          <div className="-mt-1 mb-2 flex gap-1 rounded-md bg-sand/40 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setMode("catalogue")}
              className={`flex-1 rounded px-3 py-1.5 transition-colors ${
                mode === "catalogue"
                  ? "bg-canopy text-white"
                  : "text-bark hover:bg-sand"
              }`}
            >
              Pick from FreshTrack
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("manual");
                setPickedCatalogueId(null);
              }}
              className={`flex-1 rounded px-3 py-1.5 transition-colors ${
                mode === "manual"
                  ? "bg-canopy text-white"
                  : "text-bark hover:bg-sand"
              }`}
            >
              Add manually
            </button>
          </div>
        )}

        {/* Catalogue search/picker */}
        {!isEdit && mode === "catalogue" && (
          <div className="space-y-2 rounded-lg border border-sand/60 bg-warmwhite p-3">
            <Input
              value={catalogueQuery}
              onChange={(e) => setCatalogueQuery(e.target.value)}
              placeholder="Search FreshTrack farms by code or name…"
              className="border-sand bg-white text-sm"
            />
            <div className="max-h-44 overflow-y-auto rounded border border-sand/60 bg-cream/30">
              {catalogueLoading ? (
                <p className="px-3 py-4 text-xs text-stone">Loading catalogue…</p>
              ) : (catalogue ?? []).length === 0 ? (
                <p className="px-3 py-4 text-xs text-stone">
                  No matching FreshTrack farms. Either the sync hasn&apos;t
                  populated the catalogue yet, or every match is already
                  provisioned. Switch to <em>Add manually</em> to bypass.
                </p>
              ) : (
                <ul className="divide-y divide-sand/40">
                  {(catalogue ?? []).map((row) => (
                    <li key={row.freshtrack_id}>
                      <button
                        type="button"
                        onClick={() => pickCatalogueRow(row)}
                        className={`flex w-full items-start justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-canopy/10 ${
                          pickedCatalogueId === row.freshtrack_id
                            ? "bg-canopy/15 ring-1 ring-canopy/40"
                            : ""
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-soil">
                            <span className="mr-1.5 rounded bg-sand/70 px-1.5 py-0.5 font-mono text-xs text-bark">
                              {row.code ?? "—"}
                            </span>
                            {row.name ?? "(no name)"}
                          </p>
                          <p className="mt-0.5 text-xs text-stone">
                            {row.classification === "self_paid_farm" ? (
                              <>Self-paid grower (also acts as own recipient)</>
                            ) : row.parent_name ? (
                              <>Under {row.parent_name}</>
                            ) : (
                              <>No parent recipient in FreshTrack</>
                            )}
                            {row.abn ? ` · ABN ${row.abn}` : ""}
                          </p>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {pickedCatalogueId && (
              <p className="text-xs text-canopy">
                Picked. Adjust the fields below if needed before saving.
              </p>
            )}
          </div>
        )}

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-bark">
                Name *
              </label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Farm name"
                className="border-sand bg-white"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-bark">
                Code *
              </label>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="e.g. LMBCO"
                className="border-sand bg-white"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-bark">
                FreshTrack code
              </label>
              <Input
                value={freshtrackCode}
                onChange={(e) => setFreshtrackCode(e.target.value)}
                placeholder="entity code in FreshTrack"
                className="border-sand bg-white"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-bark">
                ABN
              </label>
              <Input
                value={abn}
                onChange={(e) => setAbn(e.target.value)}
                className="border-sand bg-white"
              />
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-bark">
              Paid by (RCTI recipient)
            </label>
            <select
              value={recipientId}
              onChange={(e) => setRecipientId(e.target.value)}
              className="w-full rounded-md border border-sand bg-white px-3 py-2 text-sm"
            >
              <option value="">— unassigned —</option>
              {recipients.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            {recipients.length === 0 && (
              <p className="mt-1 text-xs text-stone">
                No recipients in this group yet. Add one in the RCTI Recipients section above.
              </p>
            )}
          </div>
          {isEdit && (
            <label className="flex items-center gap-2 text-sm text-bark">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
              />
              Active
            </label>
          )}
          {save.isError && (
            <p className="text-xs text-blaze">{save.error?.message}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="bg-canopy text-white hover:bg-canopy/90"
            disabled={!name.trim() || !code.trim() || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Saving…" : isEdit ? "Save changes" : "Add farm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
