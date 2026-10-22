CREATE TABLE `agent_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`agent` text NOT NULL,
	`external_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`ended_reason` text,
	`used_tokens` integer,
	`context_size` integer
);
--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	`text` text NOT NULL,
	`status` text NOT NULL,
	`tool_calls` text NOT NULL,
	`agent_session_id` text,
	`created_at` integer NOT NULL,
	`seq` integer NOT NULL,
	FOREIGN KEY (`agent_session_id`) REFERENCES `agent_sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
