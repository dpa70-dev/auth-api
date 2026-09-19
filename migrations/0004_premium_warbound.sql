CREATE TABLE `otp_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`code_hash` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "otp_codes_status_check" CHECK("otp_codes"."status" IN ('pending','used','revoked'))
);
--> statement-breakpoint
CREATE INDEX `otp_codes_email_idx` ON `otp_codes` (`email`);--> statement-breakpoint
CREATE INDEX `otp_codes_status_idx` ON `otp_codes` (`status`);--> statement-breakpoint
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
	CONSTRAINT "refresh_tokens_provider_check" CHECK("__new_refresh_tokens"."provider" IN ('local','google','magic','otp'))
);
--> statement-breakpoint
INSERT INTO `__new_refresh_tokens`("jti", "token_hash", "user_id", "family_id", "status", "provider", "expires_at", "created_at") SELECT "jti", "token_hash", "user_id", "family_id", "status", "provider", "expires_at", "created_at" FROM `refresh_tokens`;--> statement-breakpoint
DROP TABLE `refresh_tokens`;--> statement-breakpoint
ALTER TABLE `__new_refresh_tokens` RENAME TO `refresh_tokens`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `refresh_tokens_token_hash_unique` ON `refresh_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `refresh_tokens_user_id_idx` ON `refresh_tokens` (`user_id`);--> statement-breakpoint
CREATE INDEX `refresh_tokens_family_id_idx` ON `refresh_tokens` (`family_id`);