import { env } from "cloudflare:workers";

import { getDb } from "../../../db";
import { dataImports } from "../../../db/schema";
import { authenticatedEmail, isAuthorizedUploader } from "./_auth";

type ImportMetadata = {
  fileName: string;
  availableEnd: string;
  recordsImported: number;
};

export async function POST(request: Request) {
  const email = authenticatedEmail(request);
  if (!isAuthorizedUploader(email)) {
    return Response.json({ error: "Apenas o administrador pode atualizar a base." }, { status: 403 });
  }

  const form = await request.formData();
  const source = form.get("source");
  const dashboard = form.get("dashboard");
  const products = form.get("products");
  const sellers = form.get("sellers");
  const brands = form.get("brands");
  const metadataText = form.get("metadata");

  if (!(source instanceof File) || !(dashboard instanceof File) || !(products instanceof File) || typeof metadataText !== "string") {
    return Response.json({ error: "Pacote de importação incompleto." }, { status: 400 });
  }
  if (!source.name.toLowerCase().endsWith(".ods") || source.size > 60 * 1024 * 1024) {
    return Response.json({ error: "Envie uma ODS de até 60 MB." }, { status: 400 });
  }
  if (dashboard.size > 18 * 1024 * 1024 || products.size > 12 * 1024 * 1024) {
    return Response.json({ error: "Os dados processados excederam o limite seguro." }, { status: 400 });
  }
  if ((sellers instanceof File && sellers.size > 12 * 1024 * 1024) || (brands instanceof File && brands.size > 18 * 1024 * 1024)) {
    return Response.json({ error: "Os dados de lojas, vendedores ou marcas excederam o limite seguro." }, { status: 400 });
  }

  let metadata: ImportMetadata;
  try {
    metadata = JSON.parse(metadataText) as ImportMetadata;
  } catch {
    return Response.json({ error: "Metadados da importação inválidos." }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(metadata.availableEnd) || !Number.isFinite(metadata.recordsImported)) {
    return Response.json({ error: "Resumo da importação inválido." }, { status: 400 });
  }

  const id = crypto.randomUUID();
  const uploadedAt = new Date().toISOString();
  const prefix = `imports/${id}`;
  const [sourceBytes, dashboardBytes, productsBytes, sellersBytes, brandsBytes] = await Promise.all([
    source.arrayBuffer(),
    dashboard.arrayBuffer(),
    products.arrayBuffer(),
    sellers instanceof File ? sellers.arrayBuffer() : Promise.resolve(null),
    brands instanceof File ? brands.arrayBuffer() : Promise.resolve(null),
  ]);
  await Promise.all([
    env.BUCKET.put(`${prefix}/source.ods`, sourceBytes, { httpMetadata: { contentType: source.type || "application/vnd.oasis.opendocument.spreadsheet" } }),
    env.BUCKET.put(`${prefix}/dashboard.json.gz`, dashboardBytes, { httpMetadata: { contentType: "application/json" } }),
    env.BUCKET.put(`${prefix}/products.json.gz`, productsBytes, { httpMetadata: { contentType: "application/json" } }),
  ]);
  if (sellersBytes) await Promise.all([
    env.BUCKET.put(`${prefix}/sellers.json.gz`, sellersBytes, { httpMetadata: { contentType: "application/json" } }),
    env.BUCKET.put("current/sellers.json.gz", sellersBytes, { httpMetadata: { contentType: "application/json" } }),
  ]);
  if (brandsBytes) await Promise.all([
    env.BUCKET.put(`${prefix}/brands.json.gz`, brandsBytes, { httpMetadata: { contentType: "application/json" } }),
    env.BUCKET.put("current/brands.json.gz", brandsBytes, { httpMetadata: { contentType: "application/json" } }),
  ]);
  await Promise.all([
    env.BUCKET.put("current/dashboard.json.gz", dashboardBytes, { httpMetadata: { contentType: "application/json" } }),
    env.BUCKET.put("current/products.json.gz", productsBytes, { httpMetadata: { contentType: "application/json" } }),
  ]);

  await getDb().insert(dataImports).values({
    id,
    fileName: metadata.fileName || source.name,
    fileSize: source.size,
    uploadedAt,
    availableEnd: metadata.availableEnd,
    recordsImported: Math.round(metadata.recordsImported),
    uploaderEmail: email,
    status: "completed",
  });

  return Response.json({ id, uploadedAt, availableEnd: metadata.availableEnd });
}
