CREATE TABLE `attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`question_id` text NOT NULL,
	`card_id` text,
	`activity_id` text,
	`mode` text NOT NULL,
	`status` text NOT NULL,
	`score` integer,
	`raw_score` integer,
	`max_score` integer NOT NULL,
	`hint_rung` integer NOT NULL,
	`answer` text,
	`choices` text,
	`quote` text,
	`strengths` text,
	`gap` text,
	`graded_by` text,
	`retry` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `cards` (
	`id` text PRIMARY KEY NOT NULL,
	`set_id` text NOT NULL,
	`question_id` text NOT NULL,
	`position` integer NOT NULL,
	`status` text NOT NULL,
	`draft_text` text DEFAULT '' NOT NULL,
	`draft_choices` text NOT NULL,
	`hints_used` integer DEFAULT 0 NOT NULL,
	`retry` integer DEFAULT false NOT NULL,
	`attempt_id` text,
	`error` text,
	FOREIGN KEY (`set_id`) REFERENCES `practice_sets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `practice_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`activity_id` text NOT NULL,
	`target_id` text,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`reveal` text NOT NULL,
	`status` text NOT NULL,
	`deadline` integer,
	`created_at` integer NOT NULL,
	`submitted_at` integer,
	`graded_at` integer,
	`reported_at` integer,
	FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_id`) REFERENCES `preparation_targets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `question_schedule` (
	`question_id` text PRIMARY KEY NOT NULL,
	`box` integer NOT NULL,
	`due_on` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `agent_sessions` ADD `role` text DEFAULT 'chat' NOT NULL;--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `card_id` text;--> statement-breakpoint
ALTER TABLE `questions` ADD `hints` text;