PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_refresh_tokens` (
	`jti` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`user_id` text NOT NULL,
	`family_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`provider` text,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "refresh_tokens_status_check" CHECK("__new_refresh_tokens"."status" IN ('active','used','revoked')),
	CONSTRAINT "refresh_tokens_provider_check" CHECK("__new_refresh_tokens"."provider" IN ('local','google','magic','otp','guest'))
);
--> statement-breakpoint
INSERT INTO `__new_refresh_tokens`("jti", "token_hash", "user_id", "family_id", "status", "provider", "expires_at", "created_at") SELECT "jti", "token_hash", "user_id", "family_id", "status", "provider", "expires_at", "created_at" FROM `refresh_tokens`;--> statement-breakpoint
DROP TABLE `refresh_tokens`;--> statement-breakpoint
ALTER TABLE `__new_refresh_tokens` RENAME TO `refresh_tokens`;--> statement-breakpoint
-- foreign_keys permanece OFF hasta el final del archivo: reactivarlo aquí (como genera
-- drizzle-kit) haría que el `DROP TABLE users` de abajo ejecute un DELETE implícito sobre el
-- padre y el CASCADE de refresh_tokens.user_id BORRE los tokens legacy. Corregido a mano (T10).
CREATE UNIQUE INDEX `refresh_tokens_token_hash_unique` ON `refresh_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `refresh_tokens_user_id_idx` ON `refresh_tokens` (`user_id`);--> statement-breakpoint
CREATE INDEX `refresh_tokens_family_id_idx` ON `refresh_tokens` (`family_id`);--> statement-breakpoint
CREATE TABLE `__new_users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text,
	`password_hash` text,
	`google_sub` text,
	`email_verified` integer DEFAULT false NOT NULL,
	`kind` text DEFAULT 'registered' NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "users_identity_check" CHECK("__new_users"."password_hash" IS NOT NULL OR "__new_users"."google_sub" IS NOT NULL OR "__new_users"."email_verified" = 1 OR "__new_users"."kind" = 'guest'),
	CONSTRAINT "users_kind_check" CHECK("__new_users"."kind" IN ('registered','guest'))
);
--> statement-breakpoint
-- La columna nueva `kind` se omite del INSERT: el DEFAULT 'registered' la llena en las filas copiadas
-- (drizzle-kit la incluía en el SELECT desde la tabla vieja, que no la tiene → no such column).
INSERT INTO `__new_users`("id", "email", "password_hash", "google_sub", "email_verified", "created_at") SELECT "id", "email", "password_hash", "google_sub", "email_verified", "created_at" FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_google_sub_unique` ON `users` (`google_sub`);--> statement-breakpoint
PRAGMA foreign_keys=ON;