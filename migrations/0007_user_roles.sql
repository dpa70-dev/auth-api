PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text,
	`password_hash` text,
	`google_sub` text,
	`email_verified` integer DEFAULT false NOT NULL,
	`kind` text DEFAULT 'registered' NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "users_identity_check" CHECK("__new_users"."kind" = 'guest' OR ("__new_users"."email" IS NOT NULL AND ("__new_users"."password_hash" IS NOT NULL OR "__new_users"."google_sub" IS NOT NULL OR "__new_users"."email_verified" = 1))),
	CONSTRAINT "users_kind_check" CHECK("__new_users"."kind" IN ('registered','guest')),
	CONSTRAINT "users_role_check" CHECK("__new_users"."role" IN ('user','admin'))
);
--> statement-breakpoint
INSERT INTO `__new_users`("id", "email", "password_hash", "google_sub", "email_verified", "kind", "created_at") SELECT "id", "email", "password_hash", "google_sub", "email_verified", "kind", "created_at" FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_google_sub_unique` ON `users` (`google_sub`);