CREATE TABLE `note_sources` (
	`note_id` text NOT NULL,
	`source_id` text NOT NULL,
	PRIMARY KEY(`note_id`, `source_id`),
	FOREIGN KEY (`note_id`) REFERENCES `research_notes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `question_sources` (
	`question_id` text NOT NULL,
	`source_id` text NOT NULL,
	PRIMARY KEY(`question_id`, `source_id`),
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `research_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`target_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`target_id`) REFERENCES `preparation_targets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `research_notes_slug` ON `research_notes` (`slug`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`url` text,
	`title` text,
	`fetched_at` integer NOT NULL,
	`hash` text NOT NULL,
	`archive_path` text NOT NULL,
	`activity_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sources_hash` ON `sources` (`hash`);--> statement-breakpoint
CREATE TABLE `topic_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`target_id` text NOT NULL,
	`topic_id` text NOT NULL,
	`priority` text NOT NULL,
	`reason` text,
	`status` text NOT NULL,
	`activity_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`target_id`) REFERENCES `preparation_targets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `topic_sources` (
	`topic_id` text NOT NULL,
	`source_id` text NOT NULL,
	PRIMARY KEY(`topic_id`, `source_id`),
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `questions` ADD `activity_id` text REFERENCES activities(id);