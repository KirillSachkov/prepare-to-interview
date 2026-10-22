CREATE TABLE `activities` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`target_id` text,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`summary` text,
	FOREIGN KEY (`target_id`) REFERENCES `preparation_targets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `candidate_profile` (
	`id` text PRIMARY KEY NOT NULL,
	`experience` text,
	`stack` text NOT NULL,
	`strengths` text NOT NULL,
	`weak_spots` text NOT NULL,
	`preferences` text,
	`calibration` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `decision_log` (
	`id` text PRIMARY KEY NOT NULL,
	`target_id` text,
	`decision` text NOT NULL,
	`reason` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`target_id`) REFERENCES `preparation_targets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `preparation_targets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`grade` text,
	`market` text NOT NULL,
	`language` text NOT NULL,
	`interview_date` text,
	`mission` text NOT NULL,
	`vacancies` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `questions` (
	`id` text PRIMARY KEY NOT NULL,
	`topic_id` text NOT NULL,
	`type` text NOT NULL,
	`prompt` text NOT NULL,
	`options` text,
	`reference_answer` text,
	`verified` integer DEFAULT false NOT NULL,
	`rubric_anchors` text,
	`status` text NOT NULL,
	`origin` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `target_topics` (
	`target_id` text NOT NULL,
	`topic_id` text NOT NULL,
	`priority` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`target_id`, `topic_id`),
	FOREIGN KEY (`target_id`) REFERENCES `preparation_targets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `topics` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`key` text NOT NULL,
	`parent_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `topics_key` ON `topics` (`key`);