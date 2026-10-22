DELETE FROM `canvas_layout` WHERE `node_id` IN (SELECT `id` FROM `demo_notes`);--> statement-breakpoint
DROP TABLE `demo_notes`;