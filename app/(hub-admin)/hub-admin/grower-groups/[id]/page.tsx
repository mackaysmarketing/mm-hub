"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Save, AlertTriangle } from "lucide-react";

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
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";

interface GrowerRow {
  id: string;
  name: string;
  code: string | null;
  active: boolean;
}

interface GroupDetail {
  id: string;
  name: string;
  code: string | null;
  abn: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  address: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
  growers: GrowerRow[];
}

export default function EditGrowerGroupPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [abn, setAbn] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [address, setAddress] = useState("");
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [active, setActive] = useState(true);
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const { data: group, isLoading } = useQuery<GroupDetail>({
    queryKey: ["hub-admin-grower-group", params.id],
    queryFn: () =>
      fetch(`/api/hub-admin/grower-groups/${params.id}`).then((r) => {
        if (!r.ok) throw new Error("Failed to load group");
        return r.json();
      }),
  });

  useEffect(() => {
    if (group) {
      setName(group.name);
      setCode(group.code ?? "");
      setAbn(group.abn ?? "");
      setContactName(group.contact_name ?? "");
      setContactEmail(group.contact_email ?? "");
      setContactPhone(group.contact_phone ?? "");
      setAddress(group.address ?? "");
      setActive(group.active);
    }
  }, [group]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/hub-admin/grower-groups/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          code: code || null,
          abn: abn || null,
          contact_name: contactName || null,
          contact_email: contactEmail || null,
          contact_phone: contactPhone || null,
          address: address || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["hub-admin-grower-group", params.id],
      });
      queryClient.invalidateQueries({
        queryKey: ["hub-admin-grower-groups"],
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/hub-admin/grower-groups/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: false }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to deactivate");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["hub-admin-grower-groups"],
      });
      router.push("/hub-admin/grower-groups");
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (!group) {
    return (
      <div className="py-12 text-center text-sm text-stone">
        Grower group not found.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back + Title */}
      <div className="flex items-center gap-3">
        <Link href="/hub-admin/grower-groups">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowLeft className="h-4 w-4 text-stone" />
          </Button>
        </Link>
        <h1 className="text-lg font-semibold text-soil">{group.name}</h1>
        {!group.active && (
          <span className="rounded-full bg-blaze/10 px-2 py-0.5 text-xs font-medium text-blaze">
            Inactive
          </span>
        )}
      </div>

      {/* Details Card */}
      <div className="rounded-xl border border-sand bg-warmwhite p-6 space-y-5">
        <h2 className="text-sm font-semibold text-soil">Group Details</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-bark">
              Name *
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="border-sand bg-white"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-bark">
              Code
            </label>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="e.g. GRP001"
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
              placeholder="Australian Business Number"
              className="border-sand bg-white"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-bark">
              Contact Name
            </label>
            <Input
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              className="border-sand bg-white"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-bark">
              Contact Email
            </label>
            <Input
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              className="border-sand bg-white"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-bark">
              Contact Phone
            </label>
            <Input
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              className="border-sand bg-white"
            />
          </div>
          <div className="md:col-span-2">
            <label className="mb-1.5 block text-xs font-medium text-bark">
              Address
            </label>
            <Input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="border-sand bg-white"
            />
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <Button
            size="sm"
            className="bg-canopy text-white hover:bg-canopy/90"
            disabled={!name.trim() || saveMutation.isPending}
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

      {/* Growers in Group */}
      <div className="rounded-xl border border-sand bg-warmwhite p-6 space-y-4">
        <h2 className="text-sm font-semibold text-soil">
          Growers in this Group{" "}
          <span className="ml-1 text-xs font-normal text-stone">
            ({group.growers.length})
          </span>
        </h2>

        {group.growers.length === 0 ? (
          <p className="text-sm text-stone">
            No growers assigned to this group yet.
          </p>
        ) : (
          <div className="rounded-lg border border-sand/60">
            <Table>
              <TableHeader>
                <TableRow className="border-sand hover:bg-transparent">
                  <TableHead className="text-xs text-stone">Name</TableHead>
                  <TableHead className="text-xs text-stone">Code</TableHead>
                  <TableHead className="text-xs text-stone">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.growers.map((grower) => (
                  <TableRow key={grower.id} className="border-sand/50">
                    <TableCell className="font-medium text-soil">
                      {grower.name}
                    </TableCell>
                    <TableCell className="text-bark">
                      {grower.code ?? (
                        <span className="text-stone">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          grower.active
                            ? "bg-canopy/10 text-canopy"
                            : "bg-blaze/10 text-blaze"
                        }`}
                      >
                        {grower.active ? "Active" : "Inactive"}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Danger Zone */}
      {group.active && (
        <div className="rounded-xl border border-blaze/20 bg-blaze/5 p-6">
          <h2 className="text-sm font-semibold text-blaze">Danger Zone</h2>
          <p className="mt-1 text-xs text-bark">
            Deactivating this group will not remove grower assignments but will
            hide it from active lists.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3 border-blaze/30 text-blaze hover:bg-blaze/10"
            onClick={() => setDeactivateOpen(true)}
          >
            <AlertTriangle className="h-4 w-4" />
            Deactivate Group
          </Button>
        </div>
      )}

      {/* Deactivate Confirmation */}
      <Dialog open={deactivateOpen} onOpenChange={setDeactivateOpen}>
        <DialogContent className="bg-warmwhite">
          <DialogHeader>
            <DialogTitle className="text-blaze">Deactivate Group</DialogTitle>
            <DialogDescription className="text-stone">
              Are you sure you want to deactivate{" "}
              <strong>{group.name}</strong>? The group and its grower
              assignments will remain but won&apos;t appear in active lists.
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
