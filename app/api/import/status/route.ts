import { desc } from "drizzle-orm";

import { getDb } from "../../../../db";
import { dataImports } from "../../../../db/schema";
import { BASELINE } from "../../data/_shared";
import { authenticatedEmail, isAuthorizedUploader } from "../_auth";

export async function GET(request: Request) {
  const email = authenticatedEmail(request);
  let lastImport = null;
  try {
    [lastImport] = await getDb()
      .select()
      .from(dataImports)
      .orderBy(desc(dataImports.uploadedAt))
      .limit(1);
  } catch {
    // A primeira publicação pode responder antes de a migração do D1 terminar.
  }

  const lastUpload = lastImport && lastImport.availableEnd > BASELINE.availableEnd ? lastImport : {
    id: "published-baseline",
    fileName: BASELINE.fileName,
    fileSize: 0,
    uploadedAt: BASELINE.uploadedAt,
    availableEnd: BASELINE.availableEnd,
    recordsImported: BASELINE.recordsImported,
    uploaderEmail: "system",
    status: "completed",
  };
  return Response.json({
    authenticated: Boolean(email),
    canUpload: isAuthorizedUploader(email),
    lastUpload,
  });
}
