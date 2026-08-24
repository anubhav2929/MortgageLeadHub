import { NextResponse } from "next/server";
import { downloadPrivateDocument } from "@/adapters/documentStorage";
import { can } from "@/core/rbac";
import { getOptionalUser } from "@/domain/session";
import { getDb } from "@/domain/store";

export async function GET(_request: Request, context: { params: Promise<{ documentId: string }> }) {
  const user = await getOptionalUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { documentId } = await context.params;
  const db = await getDb();
  const document = db.leadDocuments.find((item) => item.id === documentId);
  const lead = document ? db.leads.get(document.leadId) : undefined;
  if (!document || !lead) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!can({ role: user.role, officerId: user.officerId }, "VIEW_LEAD_PII", lead)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!document.storageRef) return NextResponse.json({ error: "Document is not available in private storage" }, { status: 410 });
  try {
    const stored = await downloadPrivateDocument(document.storageRef);
    const bytes = await stored.arrayBuffer();
    const safeFilename = document.filename.replace(/[\r\n"\\/]/g, "_");
    return new NextResponse(bytes, {
      headers: {
        "content-type": document.mimeType,
        "content-disposition": `attachment; filename="${safeFilename}"`,
        "cache-control": "private, no-store, max-age=0",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[documents] secure download failed", error);
    return NextResponse.json({ error: "Document is temporarily unavailable" }, { status: 503 });
  }
}
