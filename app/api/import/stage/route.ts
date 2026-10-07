import { env } from "cloudflare:workers";
import { authenticatedEmail, isAuthorizedUploader } from "../_auth";

const KINDS = new Set(["dashboard", "products", "sellers", "brands"]);
const MAX_CHUNK = 1_700_000;

export async function POST(request: Request) {
  const email = authenticatedEmail(request);
  if (!isAuthorizedUploader(email)) return Response.json({ error: "Apenas o administrador pode atualizar a base." }, { status: 403 });
  const url = new URL(request.url);
  const importId = url.searchParams.get("importId") ?? "";
  const kind = url.searchParams.get("kind") ?? "";
  const index = Number(url.searchParams.get("index"));
  const total = Number(url.searchParams.get("total"));
  if (!/^[a-z0-9-]{16,80}$/i.test(importId) || !KINDS.has(kind) || !Number.isInteger(index) || !Number.isInteger(total) || index < 0 || total < 1 || total > 100 || index >= total) {
    return Response.json({ error: "Parte da importação inválida." }, { status: 400 });
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_CHUNK) return Response.json({ error: "A parte enviada excede o limite seguro." }, { status: 400 });
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > MAX_CHUNK) return Response.json({ error: "A parte enviada está vazia ou excede o limite seguro." }, { status: 400 });
  await env.BUCKET.put(`staging/${importId}/${kind}/${String(index).padStart(4, "0")}.part`, bytes, { httpMetadata: { contentType: "application/octet-stream" } });
  return Response.json({ ok: true, kind, index, total });
}
