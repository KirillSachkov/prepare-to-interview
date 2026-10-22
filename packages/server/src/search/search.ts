// Full-text search (ADR-0003) over Questions and Reference answers, Research notes, raw Sources,
// and Chat transcripts, ranked by BM25. The index folds case for Cyrillic and Latin and ё to е;
// queries match word stems by prefix, so Russian word forms ("индексы", "индексов") find each other.
import { inArray, sql } from "drizzle-orm";
import { searchKinds, type SearchHit, type SearchKind } from "@prepare-to-interview/shared";
import type { Database } from "../db/database.ts";
import { chatMessages, questions, researchNotes, sources, topics } from "../db/schema.ts";

export { searchKinds };

/** Text as the index stores it: ё folded to е (case and other diacritics fold in the tokenizer). */
export function foldForSearch(text: string): string {
  return text.replace(/ё/g, "е").replace(/Ё/g, "Е");
}

/** Russian inflection endings, longest first; a light stemmer for prefix matching, not a morphology. */
const russianEndings = [
  "иями", "ями", "ами", "ией", "ием", "иях", "ого", "его", "ому", "ему", "ыми", "ими", "ость", "ости", "ение", "ения", "ений", "ании", "ание",
  "ться", "тся", "ает", "яет", "ует", "ают", "яют", "уют", "ов", "ев", "ей", "ий", "ый", "ой", "ая", "яя", "ое", "ее", "ые", "ие", "ия", "ии",
  "ам", "ям", "ах", "ях", "ом", "ем", "ую", "юю", "а", "я", "о", "е", "ы", "и", "у", "ю", "ь", "й",
];
const englishEndings = ["ings", "ing", "ies", "es", "ed", "s"];
const minStem = 4;

/** The stem a query word matches by prefix. */
export function stem(word: string): string {
  const endings = /[а-я]/.test(word) ? russianEndings : englishEndings;
  for (const ending of endings) {
    if (word.endsWith(ending) && word.length - ending.length >= minStem) return word.slice(0, -ending.length);
  }
  return word;
}

const maxTerms = 12;

/** An FTS5 query matching any of the words' stems; `null` when the query has no words. */
export function matchExpression(query: string): string | null {
  const words = foldForSearch(query.toLocaleLowerCase()).match(/[\p{L}\p{N}]+/gu) ?? [];
  const long = words.filter((w) => w.length >= 2);
  const terms = [...new Set((long.length ? long : words).map(stem))].slice(0, maxTerms);
  if (!terms.length) return null;
  return terms.map((t) => `"${t}"*`).join(" OR ");
}

export class Search {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  /** Ranked hits, best first; Questions carry their status and Topic, Sources their URL, notes their slug. */
  search(query: string, options: { kinds?: readonly SearchKind[]; limit?: number } = {}): SearchHit[] {
    const match = matchExpression(query);
    if (!match) return [];
    const kinds = options.kinds?.length ? options.kinds : searchKinds;
    const rows = this.#db.all<{ kind: SearchKind; ref: string; title: string; snippet: string }>(sql`
      SELECT kind, ref, title, snippet(search_index, -1, '[', ']', '…', 12) AS snippet
      FROM search_index
      WHERE search_index MATCH ${match} AND kind IN (${sql.join(kinds.map((k) => sql`${k}`), sql`, `)})
      ORDER BY bm25(search_index, 0, 0, 3.0, 1.0, 2.0)
      LIMIT ${options.limit ?? 10}
    `);
    return this.#describe(rows);
  }

  #describe(rows: { kind: SearchKind; ref: string; title: string; snippet: string }[]): SearchHit[] {
    const ids = (kind: SearchKind) => rows.filter((r) => r.kind === kind).map((r) => r.ref);
    const questionIds = ids("question");
    const questionRows = new Map(
      (questionIds.length
        ? this.#db
            .select({ id: questions.id, prompt: questions.prompt, status: questions.status, topic: topics.name })
            .from(questions)
            .innerJoin(topics, sql`${topics.id} = ${questions.topicId}`)
            .where(inArray(questions.id, questionIds))
            .all()
        : []
      ).map((q) => [q.id, q]),
    );
    const sourceIds = ids("source");
    const sourceRows = new Map((sourceIds.length ? this.#db.select().from(sources).where(inArray(sources.id, sourceIds)).all() : []).map((s) => [s.id, s]));
    const noteIds = ids("note");
    const noteRows = new Map((noteIds.length ? this.#db.select().from(researchNotes).where(inArray(researchNotes.id, noteIds)).all() : []).map((n) => [n.id, n]));
    const messageIds = ids("transcript");
    const messageRows = new Map(
      (messageIds.length ? this.#db.select().from(chatMessages).where(inArray(chatMessages.id, messageIds)).all() : []).map((m) => [m.id, m]),
    );
    return rows.map((r): SearchHit => {
      switch (r.kind) {
        case "question": {
          const q = questionRows.get(r.ref);
          return { kind: r.kind, id: r.ref, title: q?.prompt ?? r.title, snippet: r.snippet, detail: q ? `${q.status} · ${q.topic}` : null };
        }
        case "source": {
          const s = sourceRows.get(r.ref);
          return { kind: r.kind, id: r.ref, title: s?.title ?? s?.url ?? r.title, snippet: r.snippet, detail: s ? (s.url ?? s.kind) : null };
        }
        case "note": {
          const n = noteRows.get(r.ref);
          return { kind: r.kind, id: r.ref, title: n?.title ?? r.title, snippet: r.snippet, detail: n?.slug ?? null };
        }
        case "transcript": {
          const m = messageRows.get(r.ref);
          return { kind: r.kind, id: r.ref, title: m ? `${m.role === "candidate" ? "Candidate" : "Interviewer"}, ${m.createdAt.toISOString().slice(0, 10)}` : r.title, snippet: r.snippet, detail: null };
        }
      }
    });
  }
}
