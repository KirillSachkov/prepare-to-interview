// The Research archive (ADR-0003): raw Sources kept immutably with their provenance, and the
// Interviewer's Markdown notes with Source links, under `<data dir>/research/`. Both are indexed
// for full-text search; files are a readable mirror, the database is the index.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { eq, inArray, sql } from "drizzle-orm";
import type { SourceRef } from "@prepare-to-interview/shared";
import type { Database } from "../db/database.ts";
import { noteSources, researchNotes, sources, type SourceKind } from "../db/schema.ts";
import { toSourceRef } from "../domain/bank.ts";
import { DomainError } from "../domain/domain.ts";
import { foldForSearch } from "../search/search.ts";

export interface SourceInput {
  kind: SourceKind;
  url?: string | null;
  title?: string | null;
  /** The raw text as fetched or pasted. */
  content: string;
  fetchedAt?: Date;
  activityId?: string | null;
}

export interface NoteInput {
  title: string;
  /** Stable name of the note; derived from the title when absent. Saving the same slug again updates the note. */
  slug?: string;
  body: string;
  sourceIds: string[];
  targetId?: string | null;
}

export interface Note {
  id: string;
  slug: string;
  title: string;
  /** Path of the Markdown file, relative to the research directory. */
  path: string;
  sources: SourceRef[];
  updated: boolean;
}

export class ResearchArchive {
  readonly #db: Database;
  readonly #root: string;
  readonly #now: () => Date;

  /** `root` is the research directory, `<data dir>/research`. */
  constructor(options: { db: Database; root: string; now: () => Date }) {
    this.#db = options.db;
    this.#root = options.root;
    this.#now = options.now;
  }

  /**
   * Archives a raw Source once: the same content (by SHA-256) returns the Source archived before.
   * The file holds a provenance header and the content as received; it is written read-only.
   */
  archiveSource(input: SourceInput): { source: SourceRef; duplicate: boolean; archivePath: string } {
    const content = input.content.replace(/\r\n/g, "\n");
    if (!content.trim()) throw new DomainError("The Source has no content.", "Pass the page or vacancy text in content.");
    const hash = crypto.createHash("sha256").update(content).digest("hex");
    const existing = this.#db.select().from(sources).where(eq(sources.hash, hash)).get();
    if (existing) return { source: toSourceRef(existing), duplicate: true, archivePath: existing.archivePath };
    const fetchedAt = input.fetchedAt ?? this.#now();
    const archivePath = path.posix.join("sources", fetchedAt.toISOString().slice(0, 7), `${hash.slice(0, 16)}.md`);
    const file = path.join(this.#root, archivePath);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const header = [
      "---",
      `kind: ${input.kind}`,
      `url: ${JSON.stringify(input.url ?? null)}`,
      `title: ${JSON.stringify(input.title ?? null)}`,
      `fetched_at: ${fetchedAt.toISOString()}`,
      `sha256: ${hash}`,
      "---",
      "",
    ].join("\n");
    try {
      fs.writeFileSync(file, header + content, { flag: "wx", mode: 0o400 });
    } catch (error) {
      // A file left by an earlier crash between writing and indexing holds the same content.
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const row = {
      id: crypto.randomUUID(),
      kind: input.kind,
      url: input.url ?? null,
      title: input.title ?? null,
      fetchedAt,
      hash,
      archivePath,
      activityId: input.activityId ?? null,
      createdAt: this.#now(),
    };
    this.#db.transaction((tx) => {
      tx.insert(sources).values(row).run();
      // Sources never change, so the app indexes each one once.
      tx.run(
        sql`INSERT INTO search_index (kind, ref, title, body, topic) VALUES ('source', ${row.id}, ${foldForSearch(row.title ?? row.url ?? "")}, ${foldForSearch(content)}, '')`,
      );
    });
    return { source: toSourceRef(row), duplicate: false, archivePath };
  }

  /** Saves or updates a note; its Source links merge with the ones saved before and are listed at the end of the file. */
  saveNote(input: NoteInput): Note {
    const base = slugify(input.slug ?? input.title);
    if (!base) throw new DomainError("The note needs a title or slug with letters or digits.", 'Pass a short "title", such as "PostgreSQL: индексы".');
    if (!input.sourceIds.length) throw new DomainError("A note links to at least one Source.", "Archive the pages with archive_source and pass their source_ids.");
    const found = this.#db.select().from(sources).where(inArray(sources.id, [...new Set(input.sourceIds)])).all();
    const missing = [...new Set(input.sourceIds)].filter((id) => !found.some((s) => s.id === id));
    if (missing.length) throw new DomainError(`Unknown source_ids: ${missing.join(", ")}.`, "Pass source_id values that archive_source returned.", { kind: "not_found" });
    const now = this.#now();
    const { id, updated, slug } = this.#db.transaction((tx) => {
      let slug = base;
      let current = tx.select().from(researchNotes).where(eq(researchNotes.slug, slug)).get();
      // A title that only shares its slug with another note ("C++: память", "C#: память") gets its own note.
      if (current && input.slug === undefined && current.title !== input.title) {
        slug = `${base.slice(0, 71)}-${crypto.createHash("sha256").update(input.title).digest("hex").slice(0, 8)}`;
        current = tx.select().from(researchNotes).where(eq(researchNotes.slug, slug)).get();
      }
      const id = current?.id ?? crypto.randomUUID();
      if (current) {
        tx.update(researchNotes).set({ title: input.title, body: input.body, updatedAt: now }).where(eq(researchNotes.id, id)).run();
      } else {
        tx.insert(researchNotes).values({ id, slug, title: input.title, body: input.body, targetId: input.targetId ?? null, createdAt: now, updatedAt: now }).run();
      }
      for (const s of found) tx.insert(noteSources).values({ noteId: id, sourceId: s.id }).onConflictDoNothing().run();
      return { id, updated: current !== undefined, slug };
    });
    const linked = this.#db
      .select({ source: sources })
      .from(noteSources)
      .innerJoin(sources, eq(sources.id, noteSources.sourceId))
      .where(eq(noteSources.noteId, id))
      .all()
      .map((r) => r.source);
    const notePath = path.posix.join("notes", `${slug}.md`);
    const file = path.join(this.#root, notePath);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const links = linked.map((s) => `- [${(s.title ?? s.url ?? s.id).replace(/[[\]]/g, "")}](${s.url ?? `../${s.archivePath}`}) · ${s.kind} · archived [${s.id}](../${s.archivePath})`);
    fs.writeFileSync(file, `# ${input.title}\n\n${input.body.trim()}\n\n## Sources\n\n${links.join("\n")}\n`, { mode: 0o600 });
    return { id, slug, title: input.title, path: notePath, sources: linked.map(toSourceRef), updated };
  }
}

/** Lowercase letters and digits joined by hyphens; Cyrillic stays as is. */
export function slugify(text: string): string {
  return text
    .toLocaleLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
