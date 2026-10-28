CREATE TABLE `mcp_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`user_id` text,
	`name` text NOT NULL,
	`scope` text NOT NULL,
	`created_at` text NOT NULL,
	`pair_expires_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`last_used_at` text,
	`revoked_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_connections_token_hash_unique` ON `mcp_connections` (`token_hash`);--> statement-breakpoint
CREATE INDEX `mcp_connection_user` ON `mcp_connections` (`user_id`);