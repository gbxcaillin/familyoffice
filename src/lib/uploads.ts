import { mkdir } from "fs/promises";
import path from "path";

// Uploaded documents live under data/uploads — inside the same writable,
// persisted volume as the SQLite database. The top-level ./uploads bind mount
// was often root-owned (Docker auto-created it), so the app user couldn't write
// there and every upload silently 500'd; data/ is already writable.
export function uploadsDir(): string {
  return path.join(process.cwd(), "data", "uploads");
}

export function uploadPath(filename: string): string {
  return path.join(uploadsDir(), filename);
}

export async function ensureUploadsDir(): Promise<void> {
  await mkdir(uploadsDir(), { recursive: true });
}
