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

export interface RctiRecipient {
  id: string;
  grower_group_id: string;
  name: string;
  abn: string | null;
  netsuite_entity_id: string | null;
  netsuite_entity_code: string | null;
  active: boolean;
}

export function RctiRecipientsSection({ groupId }: { groupId: string }) {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<RctiRecipient | null>(null);
  const [deleting, setDeleting] = useState<RctiRecipient | null>(null);

  const { data: recipients, isLoading } = useQuery<RctiRecipient[]>({
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
            RCTI Recipients{" "}
            <span className="ml-1 text-xs font-normal text-stone">
              ({recipients?.length ?? 0})
            </span>
          </h2>
          <p className="mt-0.5 text-xs text-stone">
            The financial axis — who Mackays pays. Multiple farms can share one recipient.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="border-sand"
          onClick={() => setAddOpen(true)}
        >
          <Plus className="h-4 w-4" />
          Add Recipient
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-stone">Loading…</p>
      ) : (recipients ?? []).length === 0 ? (
        <p className="text-sm text-stone">
          No RCTI recipients yet. Add one before uploading RCTI documents.
        </p>
      ) : (
        <div className="rounded-lg border border-sand/60">
          <Table>
            <TableHeader>
              <TableRow className="border-sand hover:bg-transparent">
                <TableHead className="text-xs text-stone">Name</TableHead>
                <TableHead className="text-xs text-stone">ABN</TableHead>
                <TableHead className="text-xs text-stone">NetSuite ID</TableHead>
                <TableHead className="text-xs text-stone">Status</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(recipients ?? []).map((r) => (
                <TableRow key={r.id} className="border-sand/50">
                  <TableCell className="font-medium text-soil">{r.name}</TableCell>
                  <TableCell className="text-bark">
                    {r.abn ?? <span className="text-stone">—</span>}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-bark">
                    {r.netsuite_entity_id ?? <span className="text-stone">—</span>}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        r.active
                          ? "bg-canopy/10 text-canopy"
                          : "bg-blaze/10 text-blaze"
                      }`}
                    >
                      {r.active ? "Active" : "Inactive"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-0.5">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title="Edit"
                        onClick={() => setEditing(r)}
                      >
                        <Pencil className="h-3.5 w-3.5 text-stone" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title="Delete"
                        onClick={() => setDeleting(r)}
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

      <RecipientDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        groupId={groupId}
        onSaved={() =>
          qc.invalidateQueries({ queryKey: ["hub-admin-rcti-recipients", groupId] })
        }
      />
      <RecipientDialog
        open={!!editing}
        onClose={() => setEditing(null)}
        groupId={groupId}
        recipient={editing}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ["hub-admin-rcti-recipients", groupId] });
          qc.invalidateQueries({ queryKey: ["hub-admin-rcti-recipients-all"] });
        }}
      />
      <DeleteRecipientDialog
        recipient={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={() => {
          qc.invalidateQueries({ queryKey: ["hub-admin-rcti-recipients", groupId] });
          qc.invalidateQueries({ queryKey: ["hub-admin-rcti-recipients-all"] });
        }}
      />
    </div>
  );
}

function RecipientDialog({
  open,
  onClose,
  groupId,
  recipient,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  groupId: string;
  recipient?: RctiRecipient | null;
  onSaved: () => void;
}) {
  const isEdit = !!recipient;
  const [name, setName] = useState("");
  const [abn, setAbn] = useState("");
  const [nsId, setNsId] = useState("");
  const [active, setActive] = useState(true);

  useEffect(() => {
    if (!open) return;
    if (recipient) {
      setName(recipient.name);
      setAbn(recipient.abn ?? "");
      setNsId(recipient.netsuite_entity_id ?? "");
      setActive(recipient.active);
    } else {
      setName("");
      setAbn("");
      setNsId("");
      setActive(true);
    }
  }, [open, recipient]);

  const save = useMutation({
    mutationFn: async () => {
      if (isEdit && recipient) {
        const res = await fetch(
          `/api/hub-admin/rcti-recipients/${recipient.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name,
              abn: abn || null,
              netsuite_entity_id: nsId || null,
              active,
            }),
          }
        );
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error ?? "Save failed");
        }
        return res.json();
      }
      const res = await fetch(`/api/hub-admin/rcti-recipients`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          grower_group_id: groupId,
          abn: abn || null,
          netsuite_entity_id: nsId || null,
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
            {isEdit ? "Edit recipient" : "Add RCTI Recipient"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-bark">
              Name *
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. LMB - Cooroo Bananas"
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
              placeholder="11-digit Australian Business Number"
              className="border-sand bg-white"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-bark">
              NetSuite entity ID
            </label>
            <Input
              value={nsId}
              onChange={(e) => setNsId(e.target.value)}
              placeholder="for matching imported reports"
              className="border-sand bg-white"
            />
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
            disabled={!name.trim() || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Saving…" : isEdit ? "Save changes" : "Add Recipient"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteRecipientDialog({
  recipient,
  onClose,
  onDeleted,
}: {
  recipient: RctiRecipient | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const del = useMutation({
    mutationFn: async () => {
      if (!recipient) return;
      const res = await fetch(`/api/hub-admin/rcti-recipients/${recipient.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Delete failed");
      }
      return res.json();
    },
    onSuccess: () => {
      onDeleted();
      onClose();
    },
  });

  return (
    <Dialog open={!!recipient} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-warmwhite">
        <DialogHeader>
          <DialogTitle className="text-blaze">Delete recipient?</DialogTitle>
          <DialogDescription className="text-stone">
            Refused automatically if any farms or RCTI documents still reference
            this recipient. Deactivate instead to preserve history.
          </DialogDescription>
        </DialogHeader>
        {recipient && (
          <div className="rounded-md bg-sand/30 p-3 text-xs text-bark">
            <p className="font-medium">{recipient.name}</p>
            {recipient.abn && <p className="mt-1 text-stone">ABN {recipient.abn}</p>}
          </div>
        )}
        {del.isError && (
          <p className="text-xs text-blaze">{del.error?.message}</p>
        )}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="bg-blaze text-white hover:bg-blaze/90"
            disabled={del.isPending}
            onClick={() => del.mutate()}
          >
            <Trash2 className="h-4 w-4" />
            {del.isPending ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
