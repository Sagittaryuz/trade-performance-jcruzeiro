import { env } from "cloudflare:workers";

import { getDb } from "../../../../db";
import { dataImports } from "../../../../db/schema";
import { authenticatedEmail, isAuthorizedUploader } from "../_auth";
const KINDS = ["dashboard", "products", "sellers", "brands"] as const;
type ImportMetadata = { fileName: string; fileSize: number; availableEnd: string; recordsImported: number };

async function joinParts(importId: string, kind: string, count: number) {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (let index = 0; index < count; index++) {
    const object = await env.BUCKET.get(`staging/${importId}/${kind}/${String(index).padStart(4, "0")}.part`);
    if (!object) throw new Error(`Parte ${index + 1} de ${kind} não encontrada.`);
    const bytes = new Uint8Array(await object.arrayBuffer());
    chunks.push(bytes); size += bytes.byteLength;
  }
  const joined = new Uint8Array(size);
  let offset = 0;
  chunks.forEach((chunk) => { joined.set(chunk, offset); offset += chunk.byteLength; });
  if (joined[0] !== 0x1f || joined[1] !== 0x8b) throw new Error(`O consolidado de ${kind} não está compactado corretamente.`);
  return joined;
}

export async function POST(request: Request) {
  const email = authenticatedEmail(request);
  if (!isAuthorizedUploader(email)) return Response.json({ error: "Apenas o administrador pode atualizar a base." }, { status: 403 });
  let body: { importId?: string; metadata?: ImportMetadata; parts?: Record<string, number> };
  try { body = await request.json(); } catch { return Response.json({ error: "Resumo da importação inválido." }, { status: 400 }); }
  const importId = String(body.importId ?? ""), metadata = body.metadata, parts = body.parts ?? {};
  if (!/^[a-z0-9-]{16,80}$/i.test(importId) || !metadata || !/^\d{4}-\d{2}-\d{2}$/.test(metadata.availableEnd) || !Number.isFinite(metadata.recordsImported) || !Number.isFinite(metadata.fileSize) || KINDS.some((kind) => !Number.isInteger(parts[kind]) || parts[kind] < 1 || parts[kind] > 100)) {
    return Response.json({ error: "Metadados da importação inválidos." }, { status: 400 });
  }
  try {
    const payloads = new Map<string, Uint8Array>();
    for (const kind of KINDS) payloads.set(kind, await joinParts(importId, kind, parts[kind]));
    await Promise.all(KINDS.map((kind) => env.BUCKET.put(`imports/${importId}/${kind}.json.gz`, payloads.get(kind)!, { httpMetadata: { contentType: "application/json" } })));
    await Promise.all(KINDS.map((kind) => env.BUCKET.put(`current/${kind}.json.gz`, payloads.get(kind)!, { httpMetadata: { contentType: "application/json" } })));
    const uploadedAt = new Date().toISOString();
    await env.BUCKET.put("current/manifest.json", JSON.stringify({ importId, availableEnd: metadata.availableEnd, uploadedAt, fileName: metadata.fileName, recordsImported: metadata.recordsImported }), { httpMetadata: { contentType: "application/json" } });
    try {
      await getDb().insert(dataImports).values({ id: importId, fileName: metadata.fileName, fileSize: Math.round(metadata.fileSize), uploadedAt, availableEnd: metadata.availableEnd, recordsImported: Math.round(metadata.recordsImported), uploaderEmail: email, status: "completed" });
    } catch (reason) { console.error("A base foi publicada, mas o registro de auditoria no D1 falhou.", reason); }
    return Response.json({ id: importId, uploadedAt, availableEnd: metadata.availableEnd });
  } catch (reason) {
    return Response.json({ error: reason instanceof Error ? reason.message : "Não foi possível montar a base consolidada." }, { status: 409 });
  }
}
