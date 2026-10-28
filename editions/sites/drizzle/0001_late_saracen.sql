CREATE TABLE `video_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`object_key` text NOT NULL,
	`upload_id` text,
	`sha256` text,
	`duration` integer,
	`has_audio` integer,
	`playback_key` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `video_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`video_id` text NOT NULL,
	`user_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`video_id`) REFERENCES `video_assets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `video_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`video_id` text NOT NULL,
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`context` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'uploading' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`error` text,
	`result_json` text,
	`transcript_json` text DEFAULT '[]' NOT NULL,
	`frames_json` text DEFAULT '[]' NOT NULL,
	`metrics_json` text DEFAULT '{}' NOT NULL,
	`lease_token` text,
	`lease_until` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`video_id`) REFERENCES `video_assets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `video_queue` ON `video_jobs` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `video_project` ON `video_jobs` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `video_seen` (
	`job_id` text NOT NULL,
	`user_id` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `video_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `video_seen_once` ON `video_seen` (`job_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `video_task_links` (
	`task_id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`video_id` text NOT NULL,
	`project_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`proposal_json` text NOT NULL,
	`detail_json` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`job_id`) REFERENCES `video_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`video_id`) REFERENCES `video_assets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `video_task_once` ON `video_task_links` (`project_id`,`fingerprint`);