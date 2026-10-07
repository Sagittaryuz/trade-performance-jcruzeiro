import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const dataImports = sqliteTable("data_imports", {
  id: text("id").primaryKey(),
  fileName: text("file_name").notNull(),
  fileSize: integer("file_size").notNull(),
  uploadedAt: text("uploaded_at").notNull(),
  availableEnd: text("available_end").notNull(),
  recordsImported: integer("records_imported").notNull(),
  uploaderEmail: text("uploader_email").notNull(),
  status: text("status").notNull().default("completed"),
});
