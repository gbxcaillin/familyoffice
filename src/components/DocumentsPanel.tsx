"use client";

import { useEffect, useState, useCallback } from "react";

interface Document {
  id: string;
  account_id: string | null;
  account_name: string | null;
  filename: string;
  original_name: string;
  mime_type: string;
  size: number;
  notes: string | null;
  uploaded_at: string;
}

interface Account {
  id: string;
  name: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function isImage(mime: string): boolean {
  return mime.startsWith("image/");
}

const labelClass =
  "block text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-muted mb-1.5";
const inputClass =
  "w-full bg-white border border-gbx-border px-3 py-2.5 text-sm font-body text-gbx-charcoal focus:outline-none focus:border-gbx-teal transition-colors";

// Stored-documents archive: uploads the original file and keeps it (parses
// nothing). Embedded as a section on the Import tab.
export default function DocumentsPanel() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const [accountId, setAccountId] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const load = useCallback(() => {
    Promise.all([
      fetch("/api/documents").then((r) => r.json()),
      fetch("/api/accounts").then((r) => r.json()),
    ]).then(([docs, accs]) => {
      setDocuments(docs);
      setAccounts(accs);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleUpload(file: File) {
    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    if (accountId) formData.append("account_id", accountId);
    if (notes) formData.append("notes", notes);

    await fetch("/api/documents", { method: "POST", body: formData });

    setSelectedFile(null);
    setAccountId("");
    setNotes("");
    setShowForm(false);
    setUploading(false);
    load();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (selectedFile) await handleUpload(selectedFile);
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this document?")) return;
    await fetch(`/api/documents?id=${id}`, { method: "DELETE" });
    load();
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      setSelectedFile(file);
      setShowForm(true);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-heading text-2xl font-light text-gbx-charcoal">
            Stored Documents
          </h2>
          <p className="text-sm text-gbx-muted font-body mt-1">
            Keep the original statements, screenshots and files for your records
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-gbx-teal text-white px-5 py-2.5 text-[11px] uppercase tracking-[0.15em] font-body font-medium hover:bg-gbx-deep-teal transition-colors"
        >
          {showForm ? "Cancel" : "Upload Document"}
        </button>
      </div>

      {/* Upload form / drop zone */}
      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white border border-gbx-border p-6 space-y-4">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`border-2 border-dashed p-8 text-center transition-colors ${
              dragOver ? "border-gbx-teal bg-gbx-teal/5" : "border-gbx-border"
            }`}
          >
            {selectedFile ? (
              <p className="text-sm font-body text-gbx-charcoal">
                Selected: <span className="font-medium">{selectedFile.name}</span> ({formatSize(selectedFile.size)})
              </p>
            ) : (
              <>
                <p className="text-sm font-body text-gbx-muted mb-2">
                  Drag and drop a file here, or click to browse
                </p>
                <input
                  type="file"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) setSelectedFile(file);
                  }}
                  accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.csv,.xlsx"
                  className="text-sm font-body"
                />
              </>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Link to Account (Optional)</label>
              <select className={inputClass} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">None</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Notes</label>
              <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Q3 2026 statement" />
            </div>
          </div>

          <button
            type="submit"
            disabled={!selectedFile || uploading}
            className="bg-gbx-teal text-white px-5 py-2.5 text-[11px] uppercase tracking-[0.15em] font-body font-medium hover:bg-gbx-deep-teal transition-colors disabled:opacity-50"
          >
            {uploading ? "Uploading..." : "Upload"}
          </button>
        </form>
      )}

      {/* Document grid */}
      {loading ? (
        <p className="text-gbx-muted font-body text-sm">Loading…</p>
      ) : documents.length === 0 ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`bg-gbx-soft border-2 border-dashed p-12 text-center transition-colors ${
            dragOver ? "border-gbx-teal bg-gbx-teal/5" : "border-gbx-border"
          }`}
        >
          <p className="text-gbx-muted font-body">
            No documents uploaded. Drag files here or use the upload button.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {documents.map((doc) => (
            <div key={doc.id} className="bg-white border border-gbx-border overflow-hidden">
              {/* Preview */}
              {isImage(doc.mime_type) ? (
                <div className="h-40 bg-gbx-soft flex items-center justify-center overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/documents/${doc.filename}`}
                    alt={doc.original_name}
                    className="w-full h-full object-cover"
                  />
                </div>
              ) : (
                <div className="h-40 bg-gbx-charcoal flex items-center justify-center">
                  <span className="text-2xl text-white/30 font-data uppercase">
                    {doc.original_name.split(".").pop()}
                  </span>
                </div>
              )}

              <div className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-body text-sm font-medium text-gbx-charcoal truncate">
                    {doc.original_name}
                  </h3>
                  <button
                    onClick={() => handleDelete(doc.id)}
                    className="text-gbx-muted hover:text-red-500 text-xs transition-colors shrink-0"
                  >
                    ×
                  </button>
                </div>

                <div className="flex gap-2 text-[11px] text-gbx-muted font-data">
                  <span>{formatSize(doc.size)}</span>
                  <span>·</span>
                  <span>{formatDate(doc.uploaded_at)}</span>
                </div>

                {doc.account_name && (
                  <p className="text-xs text-gbx-teal font-body">{doc.account_name}</p>
                )}
                {doc.notes && (
                  <p className="text-xs text-gbx-muted font-body">{doc.notes}</p>
                )}

                <a
                  href={`/api/documents/${doc.filename}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block text-[11px] text-gbx-teal uppercase tracking-[0.1em] font-body font-medium hover:text-gbx-deep-teal transition-colors mt-1"
                >
                  View Document
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
