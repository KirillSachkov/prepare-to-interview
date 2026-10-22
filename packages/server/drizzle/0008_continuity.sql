CREATE TABLE `review_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_session_id` text,
	`target_id` text,
	`profile` text,
	`decisions` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`settled_at` integer,
	FOREIGN KEY (`agent_session_id`) REFERENCES `agent_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_id`) REFERENCES `preparation_targets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
ALTER TABLE `agent_sessions` ADD `rotate_reason` text;--> statement-breakpoint
ALTER TABLE `agent_sessions` ADD `summary` text;--> statement-breakpoint
ALTER TABLE `agent_sessions` ADD `briefed_at` integer;--> statement-breakpoint
ALTER TABLE `attempts` ADD `corrected_from` integer;--> statement-breakpoint
ALTER TABLE `attempts` ADD `correction_reason` text;--> statement-breakpoint
ALTER TABLE `attempts` ADD `corrected_at` integer;--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `proposal_id` text;--> statement-breakpoint
ALTER TABLE `practice_sets` ADD `archived_at` integer;