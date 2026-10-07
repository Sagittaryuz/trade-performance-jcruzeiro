CREATE TABLE `data_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`file_name` text NOT NULL,
	`file_size` integer NOT NULL,
	`uploaded_at` text NOT NULL,
	`available_end` text NOT NULL,
	`records_imported` integer NOT NULL,
	`uploader_email` text NOT NULL,
	`status` text DEFAULT 'completed' NOT NULL
);
--> statement-breakpoint
INSERT INTO `data_imports` (`id`, `file_name`, `file_size`, `uploaded_at`, `available_end`, `records_imported`, `uploader_email`, `status`)
VALUES ('initial-2026-07-17', 'Relação de vendas por produto por agrupador, itens e movimentos - 17-07-2026.ods', 59626216, '2026-07-17T11:22:44Z', '2026-07-16', 497554, 'marcos.pires@jcruzeiro.com', 'completed');
