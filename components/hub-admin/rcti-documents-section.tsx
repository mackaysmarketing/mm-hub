"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload, FileText, Download, Pencil, Trash2 } from "lucide-react";
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

interface RctiDoc {
  id: string;
  recipient_id: string;
  filename: string;
  rcti_ref: string | null;
  payment_date: string | null;
  total_invoiced: number | null;
  file_size: number | null;
  uploaded_at: string;
  rcti_recipients: { name: string } | null;
}

function fmtSize(b: number | null): string {
  if (!b) return "—";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

export function RctiDocumentsSection({ groupId }: { groupId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [recipientId, setRecipientId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [rctiRef, setRctiRef] = useState("");
  const [paymentDate, setPaymentDate] = useState("");
  const [totalInvoiced, setTotalInvoiced] = useState("");
  const [editing, setEditing] = useState<RctiDoc | null>(null);
  const [deleting, setDeleting] = useState<RctiDoc | null>(null);
  const [editRef, setEditRef] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editTotal, setEditTotal] = useState("");

  const { data: recipients } = useQuery<RctiRecipient[]>({
    queryKey: ["hub-admin-rcti-recipients", groupId],
    queryFn: () =>
      fetch(`/api/hub-admin/rcti-recipients?groupId=${groupId}`).then((r) => {
        if (!r.ok) throw new Error("Failed to load recipients");
        return r.json();
      }),
  });

  // Hub admins are internal -> RLS returns every group's docs; client-side
  // filter to just this group's so the section is scoped to the page context.
  const { data: docs, isLoading } = useQuery<RctiDoc[]>({
    queryKey: ["hub-admin-rcti-documents", groupId],
    queryFn: () =>
      fetch(`/api/rcti-documents`).then((r) => {
        if (!r.ok) throw new Error("Failed to load documents");
        return r.json();
      }),
    select: (rows) => {
      const ids = new Set((recipients ?? []).map((r) => r.id));
      return rows.filter((d) => ids.has(d.recipient_id));
    },
    enabled: !!recipients,
  });

  const upload = useMutation({
    mutationFn: async () => {
      if (!file || !recipientId) throw new Error("File and recipient required");
      const fd = new FormData();
      fd.append("file", file);
      fd.append("recipient_id", recipientId);
      if (rctiRef) fd.append("rcti_ref", rctiRef);
      if (paymentDate) fd.append("payment_date", paymentDate);
      if (totalInvoiced) fd.append("total_invoiced", totalInvoiced);
      const res = await fetch(`/api/rcti-documents`, { method: "POST", body: fd });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Upload failed");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hub-admin-rcti-documents", groupId] });
      qc.invalidateQueries({ queryKey: ["rcti-documents"] });
      setOpen(false);
      setFile(null);
      setRecipientId("");
      setRctiRef("");
      setPaymentDate("");
      setTotalInvoiced("");
    },
  });

  const updateDoc = useMutation({
    mutationFn: async (doc: RctiDoc) => {
      const totalNum = editTotal.trim() === "" ? null : Number(editTotal);
      const res = await fetch(`/api/rcti-documents/${doc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rcti_ref: editRef || null,
          payment_date: editDate || null,
          total_invoiced: totalNum,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Save failed");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hub-admin-rcti-documents", groupId] });
      qc.invalidateQueries({ queryKey: ["rcti-documents"] });
      setEditing(null);
    },
  });

  const deleteDoc = useMutation({
    mutationFn: async (doc: RctiDoc) => {
      const res = await fetch(`/api/rcti-documents/${doc.id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Delete failed");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hub-admin-rcti-documents", groupId] });
      qc.invalidateQueries({ queryKey: ["rcti-documents"] });
      setDeleting(null);
    },
  });

  function openEdit(d: RctiDoc) {
    setEditing(d);
    setEditRef(d.rcti_ref ?? "");
    setEditDate(d.payment_date ?? "");
    setEditTotal(d.total_invoiced != null ? String(d.total_invoiced) : "");
  }

  const noRecipients = (recipients ?? []).length === 0;

  return (
    <div className="space-y-4 rounded-xl border border-sand bg-warmwhite p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-soil">
            RCTI Documents{" "}
            <span className="ml-1 text-xs font-normal text-stone">
              ({docs?.length ?? 0})
            </span>
          </h2>
          <p className="mt-0.5 text-xs text-stone">
            PDFs shown to the grower on Remittances. Upload from Mackays accounts.
          </p>
        </div>
        <Button
          size="sm"
          className="bg-canopy text-white hover:bg-canopy/90"
          onClick={() => setOpen(true)}
          disabled={noRecipients}
          title={noRecipients ? "Add an RCTI recipient first" : undefined}
        >
          <Upload className="h-4 w-4" />
          Upload PDF
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-stone">Loading…</p>
      ) : (docs ?? []).length === 0 ? (
        <p className="text-sm text-stone">
          {noRecipients
            ? "Add a recipient first, then upload RCTI PDFs."
            : "No RCTI documents uploaded yet."}
        </p>
      ) : (
        <div className="rounded-lg border border-sand/60">
          <Table>
            <TableHeader>
              <TableRow className="border-sand hover:bg-transparent">
                <TableHead className="text-xs text-stone">RCTI Ref</TableHead>
                <TableHead className="text-xs text-stone">Recipient</TableHead>
                <TableHead className="text-xs text-stone">Paid</TableHead>
                <TableHead className="text-xs text-stone">Size</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(docs ?? []).map((d) => (
                <TableRow key={d.id} className="border-sand/50">
                  <TableCell className="font-mono text-xs text-soil">
                    {d.rcti_ref || (
                      <span className="text-stone">{d.filename}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-bark">
                    {d.rcti_recipients?.name ?? <span className="text-stone">—</span>}
                  </TableCell>
                  <TableCell className="text-bark">
                    {d.payment_date ?? <span className="text-stone">—</span>}
                  </TableCell>
                  <TableCell className="text-xs text-bark">{fmtSize(d.file_size)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-0.5">
                      <a
                        href={`/api/rcti-documents/${d.id}/download`}
                        title="Download"
                      >
                        <Button variant="ghost" size="icon" className="h-7 w-7">
                          <Download className="h-3.5 w-3.5 text-stone" />
                        </Button>
                      </a>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title="Edit metadata"
                        onClick={() => openEdit(d)}
                      >
                        <Pencil className="h-3.5 w-3.5 text-stone" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title="Delete"
                        onClick={() => setDeleting(d)}
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

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-warmwhite">
          <DialogHeader>
            <DialogTitle className="text-soil">Upload RCTI PDF</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-bark">
                Recipient *
              </label>
              <select
                value={recipientId}
                onChange={(e) => setRecipientId(e.target.value)}
                className="w-full rounded-md border border-sand bg-white px-3 py-2 text-sm"
              >
                <option value="">— select recipient —</option>
                {(recipients ?? []).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-bark">
                PDF file *
              </label>
              <input
                type="file"
                accept="application/pdf"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-bark file:mr-3 file:rounded-md file:border-0 file:bg-sand/60 file:px-3 file:py-1.5 file:text-xs file:text-soil"
              />
              {file && (
                <p className="mt-1 text-xs text-stone">
                  {file.name} · {fmtSize(file.size)}
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-bark">
                  RCTI ref
                </label>
                <Input
                  value={rctiRef}
                  onChange={(e) => setRctiRef(e.target.value)}
                  placeholder="e.g. 2620-LMBCO"
                  className="border-sand bg-white"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-bark">
                  Payment date
                </label>
                <Input
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className="border-sand bg-white"
                />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-bark">
                Total invoiced (AUD)
              </label>
              <Input
                type="number"
                step="0.01"
                value={totalInvoiced}
                onChange={(e) => setTotalInvoiced(e.target.value)}
                placeholder="e.g. 324877.37"
                className="border-sand bg-white"
              />
            </div>
            {upload.isError && (
              <p className="text-xs text-blaze">{upload.error?.message}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="bg-canopy text-white hover:bg-canopy/90"
              disabled={!file || !recipientId || upload.isPending}
              onClick={() => upload.mutate()}
            >
              <FileText className="h-4 w-4" />
              {upload.isPending ? "Uploading…" : "Upload"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit metadata */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="bg-warmwhite">
          <DialogHeader>
            <DialogTitle className="text-soil">Edit RCTI metadata</DialogTitle>
            <DialogDescription className="text-stone">
              The PDF file itself is immutable — to replace it, delete and re-upload.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-bark">
                  RCTI ref
                </label>
                <Input
                  value={editRef}
                  onChange={(e) => setEditRef(e.target.value)}
                  className="border-sand bg-white"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-bark">
                  Payment date
                </label>
                <Input
                  type="date"
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  className="border-sand bg-white"
                />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-bark">
                Total invoiced (AUD)
              </label>
              <Input
                type="number"
                step="0.01"
                value={editTotal}
                onChange={(e) => setEditTotal(e.target.value)}
                className="border-sand bg-white"
              />
            </div>
            {updateDoc.isError && (
              <p className="text-xs text-blaze">{updateDoc.error?.message}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="bg-canopy text-white hover:bg-canopy/90"
              disabled={updateDoc.isPending}
              onClick={() => editing && updateDoc.mutate(editing)}
            >
              {updateDoc.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="bg-warmwhite">
          <DialogHeader>
            <DialogTitle className="text-blaze">Delete RCTI document?</DialogTitle>
            <DialogDescription className="text-stone">
              This removes the PDF and its metadata permanently. Growers will no longer see it.
            </DialogDescription>
          </DialogHeader>
          {deleting && (
            <div className="rounded-md bg-sand/30 p-3 text-xs text-bark">
              <p className="font-mono">{deleting.rcti_ref || deleting.filename}</p>
              {deleting.payment_date && (
                <p className="mt-1 text-stone">Paid {deleting.payment_date}</p>
              )}
            </div>
          )}
          {deleteDoc.isError && (
            <p className="text-xs text-blaze">{deleteDoc.error?.message}</p>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="bg-blaze text-white hover:bg-blaze/90"
              disabled={deleteDoc.isPending}
              onClick={() => deleting && deleteDoc.mutate(deleting)}
            >
              <Trash2 className="h-4 w-4" />
              {deleteDoc.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
