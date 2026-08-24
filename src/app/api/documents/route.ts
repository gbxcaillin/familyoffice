import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { randomUUID } from "crypto";
import { writeFile, unlink } from "fs/promises";
import path from "path";

export async function GET() {
  const db = getDb();
  const docs = db
    .prepare(
      `SELECT d.*, a.name as account_name
       FROM documents d
       LEFT JOIN accounts a ON d.account_id = a.id
       ORDER BY d.uploaded_at DESC`
    )
    .all();
  return NextResponse.json(docs);
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const accountId = formData.get("account_id") as string | null;
  const notes = formData.get("notes") as string | null;

  if (!file) {
    return NextResponse.json({ error: "File required" }, { status: 400 });
  }

  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);

  const id = `doc_${randomUUID().slice(0, 8)}`;
  const ext = path.extname(file.name) || ".bin";
  const filename = `${id}${ext}`;
  const uploadPath = path.join(process.cwd(), "uploads", filename);

  await writeFile(uploadPath, buffer);

  const db = getDb();
  db.prepare(
    "INSERT INTO documents (id, account_id, filename, original_name, mime_type, size, notes) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(id, accountId || null, filename, file.name, file.type, file.size, notes || null);

  const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get(id);
  return NextResponse.json(doc, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "ID required" }, { status: 400 });
  }

  const db = getDb();
  const doc = db.prepare("SELECT filename FROM documents WHERE id = ?").get(id) as { filename: string } | undefined;

  if (doc) {
    try {
      await unlink(path.join(process.cwd(), "uploads", doc.filename));
    } catch {}
  }

  db.prepare("DELETE FROM documents WHERE id = ?").run(id);
  return NextResponse.json({ ok: true });
}
