-- Full-text search (ADR-0003) over Questions with their Reference answers, Research notes, raw
-- Sources, and Chat transcripts. unicode61 folds case for Cyrillic and Latin alike; ё is folded to
-- е here and in queries. Triggers keep Questions, notes, and transcripts indexed; the app indexes
-- each Source once when it archives it.
CREATE VIRTUAL TABLE `search_index` USING fts5(
	kind UNINDEXED,
	ref UNINDEXED,
	title,
	body,
	topic,
	tokenize = "unicode61 remove_diacritics 2"
);
--> statement-breakpoint
CREATE TRIGGER `questions_search_insert` AFTER INSERT ON `questions` BEGIN
	INSERT INTO `search_index` (kind, ref, title, body, topic) VALUES (
		'question', new.id,
		replace(replace(new.prompt, 'ё', 'е'), 'Ё', 'Е'),
		replace(replace(coalesce(new.reference_answer, ''), 'ё', 'е'), 'Ё', 'Е'),
		replace(replace(coalesce((SELECT name FROM topics WHERE id = new.topic_id), ''), 'ё', 'е'), 'Ё', 'Е')
	);
END;
--> statement-breakpoint
CREATE TRIGGER `questions_search_update` AFTER UPDATE OF prompt, reference_answer, topic_id ON `questions` BEGIN
	DELETE FROM `search_index` WHERE kind = 'question' AND ref = old.id;
	INSERT INTO `search_index` (kind, ref, title, body, topic) VALUES (
		'question', new.id,
		replace(replace(new.prompt, 'ё', 'е'), 'Ё', 'Е'),
		replace(replace(coalesce(new.reference_answer, ''), 'ё', 'е'), 'Ё', 'Е'),
		replace(replace(coalesce((SELECT name FROM topics WHERE id = new.topic_id), ''), 'ё', 'е'), 'Ё', 'Е')
	);
END;
--> statement-breakpoint
CREATE TRIGGER `questions_search_delete` AFTER DELETE ON `questions` BEGIN
	DELETE FROM `search_index` WHERE kind = 'question' AND ref = old.id;
END;
--> statement-breakpoint
CREATE TRIGGER `notes_search_insert` AFTER INSERT ON `research_notes` BEGIN
	INSERT INTO `search_index` (kind, ref, title, body, topic) VALUES (
		'note', new.id,
		replace(replace(new.title, 'ё', 'е'), 'Ё', 'Е'),
		replace(replace(new.body, 'ё', 'е'), 'Ё', 'Е'),
		''
	);
END;
--> statement-breakpoint
CREATE TRIGGER `notes_search_update` AFTER UPDATE OF title, body ON `research_notes` BEGIN
	DELETE FROM `search_index` WHERE kind = 'note' AND ref = old.id;
	INSERT INTO `search_index` (kind, ref, title, body, topic) VALUES (
		'note', new.id,
		replace(replace(new.title, 'ё', 'е'), 'Ё', 'Е'),
		replace(replace(new.body, 'ё', 'е'), 'Ё', 'Е'),
		''
	);
END;
--> statement-breakpoint
CREATE TRIGGER `notes_search_delete` AFTER DELETE ON `research_notes` BEGIN
	DELETE FROM `search_index` WHERE kind = 'note' AND ref = old.id;
END;
--> statement-breakpoint
CREATE TRIGGER `chat_search_insert` AFTER INSERT ON `chat_messages`
WHEN new.role <> 'notice' AND new.status IN ('complete', 'cancelled') AND new.text <> '' BEGIN
	INSERT INTO `search_index` (kind, ref, title, body, topic) VALUES (
		'transcript', new.id, '', replace(replace(new.text, 'ё', 'е'), 'Ё', 'Е'), ''
	);
END;
--> statement-breakpoint
CREATE TRIGGER `chat_search_update` AFTER UPDATE OF text, status ON `chat_messages` BEGIN
	DELETE FROM `search_index` WHERE kind = 'transcript' AND ref = old.id;
	INSERT INTO `search_index` (kind, ref, title, body, topic)
	SELECT 'transcript', new.id, '', replace(replace(new.text, 'ё', 'е'), 'Ё', 'Е'), ''
	WHERE new.role <> 'notice' AND new.status IN ('complete', 'cancelled') AND new.text <> '';
END;
--> statement-breakpoint
INSERT INTO `search_index` (kind, ref, title, body, topic)
SELECT 'question', q.id,
	replace(replace(q.prompt, 'ё', 'е'), 'Ё', 'Е'),
	replace(replace(coalesce(q.reference_answer, ''), 'ё', 'е'), 'Ё', 'Е'),
	replace(replace(coalesce(t.name, ''), 'ё', 'е'), 'Ё', 'Е')
FROM `questions` q LEFT JOIN `topics` t ON t.id = q.topic_id;
--> statement-breakpoint
INSERT INTO `search_index` (kind, ref, title, body, topic)
SELECT 'transcript', id, '', replace(replace(text, 'ё', 'е'), 'Ё', 'Е'), ''
FROM `chat_messages` WHERE role <> 'notice' AND status IN ('complete', 'cancelled') AND text <> '';
