"use client";

import { useState, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  FileText,
  Upload,
  Download,
  Search,
  File,
  Image as ImageIcon,
  Table2,
  X,
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
import { useUser } from "@/hooks/use-user";

const CATEGORIES = [
  { id: "all", label: "All" },
  { id: "compliance", label: "Compliance" },
  { id: "certificate", label: "Certificates" },
  { id: "agreements", label: "Agreements" },
  { id: "unpaid_lots", label: "Unpaid Lots" },
  { id: "general", label: "General" },
];

interface DocumentRecord {
  id: string;
  name: string;
  category: string;
  file_size: number;
  mime_type: string;
  uploaded_at: string;
  uploaded_by: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(mimeType: string) {
  if (mimeType.startsWith("image/"))
    return <ImageIcon className="h-5 w-5 text-canopy" />;
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel"))
    return <Table2 className="h-5 w-5 text-forest" />;
  if (mimeType.includes("pdf"))
    return <FileText className="h-5 w-5 text-blaze" />;
  return <File className="h-5 w-5 text-stone" />;
}

function getCategoryLabel(category: string): string {
  return CATEGORIES.find((c) => c.id === category)?.label ?? category;
}

export default function DocumentsPage() {
  const { session } = useUser();
  const queryClient = useQueryClient();
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadCategory, setUploadCategory] = useState("general");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const portalAccess = session?.moduleAccess.find(
    (m) => m.module_id === "grower-portal"
  );
  const growerId =
    (portalAccess?.config as { grower_id?: string })?.grower_id ?? undefined;

  function buildParams(): string {
    const params = new URLSearchParams();
    if (growerId) params.set("growerId", growerId);
    if (category !== "all") params.set("category", category);
    if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
    return params.toString();
  }

  const queryParams = buildParams();

  const { data: documents, isLoading } = useQuery<DocumentRecord[]>({
    queryKey: ["documents", queryParams],
    queryFn: () =>
      fetch(`/api/documents?${queryParams}`).then((r) => r.json()),
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("category", uploadCategory);
      if (growerId) formData.append("growerId", growerId);
      const res = await fetch("/api/documents/upload", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Upload failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      setUploadOpen(false);
      setSelectedFile(null);
      setUploadCategory("general");
    },
  });

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearch(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => setDebouncedSearch(value), 300);
    },
    []
  );

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) setSelectedFile(file);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  return (
    <div className="space-y-6">
      <TopBar title="Documents">
        <Button
          size="sm"
          className="bg-forest text-white hover:bg-forest/90"
          onClick={() => setUploadOpen(true)}
        >
          <Upload className="h-4 w-4" />
          Upload
        </Button>
      </TopBar>

      {/* Category filter pills */}
      <div className="flex flex-wrap items-center gap-2 px-1">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setCategory(cat.id)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              category === cat.id
                ? "bg-forest text-white"
                : "bg-sand/60 text-bark hover:bg-sand"
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone" />
        <Input
          placeholder="Search documents..."
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="pl-9 border-sand bg-warmwhite"
        />
      </div>

      {/* Document grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[100px] rounded-xl" />
          ))}
        </div>
      ) : (documents ?? []).length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-sand bg-warmwhite py-16 text-center">
          <FileText className="mb-3 h-10 w-10 text-stone/50" />
          <p className="text-sm text-stone">No documents found</p>
          <p className="mt-1 text-xs text-stone/70">
            Upload a document to get started
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(documents ?? []).map((doc) => (
            <div
              key={doc.id}
              className="flex items-start gap-3 rounded-xl border border-sand bg-warmwhite p-4 transition-shadow hover:shadow-sm"
            >
              <div className="mt-0.5 shrink-0">{getFileIcon(doc.mime_type)}</div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-soil">
                  {doc.name}
                </p>
                <div className="mt-1 flex items-center gap-2 text-xs text-stone">
                  <span className="rounded bg-sand/60 px-1.5 py-0.5">
                    {getCategoryLabel(doc.category)}
                  </span>
                  <span>{formatFileSize(doc.file_size)}</span>
                  <span>
                    {new Date(doc.uploaded_at).toLocaleDateString("en-AU", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                </div>
              </div>
              <a
                href={`/api/documents/${doc.id}/download`}
                className="shrink-0 rounded-md p-1.5 text-stone transition-colors hover:bg-sand hover:text-soil"
                title="Download"
              >
                <Download className="h-4 w-4" />
              </a>
            </div>
          ))}
        </div>
      )}

      {/* Upload Dialog */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="bg-warmwhite">
          <DialogHeader>
            <DialogTitle className="text-soil">Upload Document</DialogTitle>
            <DialogDescription className="text-stone">
              Upload a document (PDF, DOC, DOCX, XLS, XLSX, JPG, PNG, TXT).
              Max 10MB.
            </DialogDescription>
          </DialogHeader>

          {/* Category selector */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-bark">
              Category
            </label>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.filter((c) => c.id !== "all").map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setUploadCategory(cat.id)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    uploadCategory === cat.id
                      ? "bg-forest text-white"
                      : "bg-sand/60 text-bark hover:bg-sand"
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* Drop zone */}
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors ${
              dragOver
                ? "border-forest bg-forest/5"
                : "border-sand hover:border-stone"
            }`}
          >
            {selectedFile ? (
              <div className="flex items-center gap-2">
                {getFileIcon(selectedFile.type)}
                <span className="text-sm text-soil">{selectedFile.name}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedFile(null);
                  }}
                  className="rounded p-0.5 hover:bg-sand"
                >
                  <X className="h-3.5 w-3.5 text-stone" />
                </button>
              </div>
            ) : (
              <>
                <Upload className="mb-2 h-8 w-8 text-stone/50" />
                <p className="text-sm text-bark">
                  Drag & drop a file here, or click to browse
                </p>
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.txt"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) setSelectedFile(file);
              }}
            />
          </div>

          {uploadMutation.isError && (
            <p className="text-xs text-blaze">
              {uploadMutation.error?.message ?? "Upload failed"}
            </p>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setUploadOpen(false);
                setSelectedFile(null);
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="bg-forest text-white hover:bg-forest/90"
              disabled={!selectedFile || uploadMutation.isPending}
              onClick={() => {
                if (selectedFile) uploadMutation.mutate(selectedFile);
              }}
            >
              {uploadMutation.isPending ? "Uploading..." : "Upload"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
