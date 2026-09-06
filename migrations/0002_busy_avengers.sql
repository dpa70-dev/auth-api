PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_magic_links` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`email` text NOT NULL,
	`purpose` text DEFAULT 'login' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "magic_links_status_check" CHECK("__new_magic_links"."status" IN ('pending','used','revoked')),
	CONSTRAINT "magic_links_purpose_check" CHECK("__new_magic_links"."purpose" IN ('login','password_reset'))
);
--> statement-breakpoint
-- La columna nueva `purpose` se omite del INSERT: el DEFAULT 'login' la llena en las filas copiadas
-- (drizzle-kit la incluía en el SELECT desde la tabla vieja, que no la tiene → no such column).
INSERT INTO `__new_magic_links`("id", "token_hash", "email", "status", "expires_at", "created_at") SELECT "id", "token_hash", "email", "status", "expires_at", "created_at" FROM `magic_links`;--> statement-breakpoint
DROP TABLE `magic_links`;--> statement-breakpoint
ALTER TABLE `__new_magic_links` RENAME TO `magic_links`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `magic_links_token_hash_unique` ON `magic_links` (`token_hash`);--> statement-breakpoint
CREATE INDEX `magic_links_email_idx` ON `magic_links` (`email`);--> statement-breakpoint
CREATE INDEX `magic_links_status_idx` ON `magic_links` (`status`);