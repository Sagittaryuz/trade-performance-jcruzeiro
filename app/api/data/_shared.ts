import { env } from "cloudflare:workers";

export const BASELINE = {
  availableEnd: "2026-07-19",
  fileName: "Relação de vendas por produto por agrupador, itens e movimentos - 20-07-2026.ods",
  uploadedAt: "2026-07-20T12:00:00.000Z",
  recordsImported: 520194,
};

export async function currentOrStatic(key: "dashboard" | "products" | "sellers" | "brands", request: Request) {
  try {
    const manifestObject = await env.BUCKET?.get("current/manifest.json");
    if (manifestObject) {
      const manifest = JSON.parse(await manifestObject.text()) as { availableEnd?: string };
      if ((manifest.availableEnd ?? "") > BASELINE.availableEnd) {
        const object = await env.BUCKET.get(`current/${key}.json.gz`);
        if (object) return new Response(object.body, { headers: { "content-type": "application/json", "cache-control": "no-store", "x-data-source": "daily-import" } });
      }
    }
  } catch (reason) {
    console.error(`Falha ao ler ${key} no armazenamento; usando base publicada.`, reason);
  }
  // Public assets are served by the Sites host before the Worker. Redirecting
  // keeps the API contract valid even when the runtime has no ASSETS binding.
  return Response.redirect(new URL(`/data/${key}.json.gz`, request.url), 307);
}
