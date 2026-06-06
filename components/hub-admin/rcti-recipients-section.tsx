"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
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
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [abn, setAbn] = useState("");
  const [nsId, setNsId] = useState("");

  const { data: recipients, isLoading } = useQuery<RctiRecipient[]>({
    queryKey: ["hub-admin-rcti-recipients", groupId],
    queryFn: () =>
      fetch(`/api/hub-admin/rcti-recipients?groupId=${groupId}`).then((r) => {
        if (!r.ok) throw new Error("Failed to load recipients");
        return r.json();
      }),
  });

  const create = useMutation({
    mutationFn: async () => {
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
        throw new Error(err.error ?? "Failed to create");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hub-admin-rcti-recipients", groupId] });
      setOpen(false);
      setName("");
      setAbn("");
      setNsId("");
    },
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
          onClick={() => setOpen(true)}
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
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-warmwhite">
          <DialogHeader>
            <DialogTitle className="text-soil">Add RCTI Recipient</DialogTitle>
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
            {create.isError && (
              <p className="text-xs text-blaze">{create.error?.message}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="bg-canopy text-white hover:bg-canopy/90"
              disabled={!name.trim() || create.isPending}
              onClick={() => create.mutate()}
            >
              {create.isPending ? "Adding…" : "Add Recipient"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
