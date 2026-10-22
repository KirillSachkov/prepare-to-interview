// Mastery visuals of the Skill map (prototype variant A): heat colours and rings.
import type { ReactNode } from "react";

export interface Heat {
  stroke: string;
  text: string;
  label: string;
}

/** Mastery colour and label: grey for a never-touched Topic, then red, amber, green. */
export function heat(mastery: number | null): Heat {
  if (mastery === null) return { stroke: "#d6d3d1", text: "text-stone-400", label: "не начата" };
  if (mastery < 0.4) return { stroke: "#e11d48", text: "text-rose-600", label: "плавает" };
  if (mastery < 0.7) return { stroke: "#d97706", text: "text-amber-600", label: "в процессе" };
  return { stroke: "#059669", text: "text-emerald-600", label: "уверенно" };
}

export const percent = (mastery: number | null) => (mastery === null ? null : Math.round(mastery * 100));

export function Ring({ mastery, size = 44, children }: { mastery: number | null; size?: number; children?: ReactNode }) {
  const stroke = 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const value = mastery ?? 0;
  return (
    <div
      role="img"
      aria-label={mastery === null ? "Освоение: не начата" : `Освоение ${String(percent(mastery))}%`}
      className="relative inline-grid shrink-0 place-items-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e7e5e4" strokeWidth={stroke} />
        {mastery !== null && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={heat(mastery).stroke}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - value)}
          />
        )}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-[11px] font-semibold text-stone-700 tabular-nums">
        {children ?? (mastery === null ? "—" : percent(mastery))}
      </div>
    </div>
  );
}

const sourceHost = (url: string) => {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/** One Source as a short line: a link when it has a URL. */
export function SourceLine({ source }: { source: { url: string | null; title: string | null } }) {
  if (!source.url) return <span>{source.title ?? "материалы кандидата"}</span>;
  const host = sourceHost(source.url);
  return (
    <a href={source.url} target="_blank" rel="noreferrer noopener" className="underline decoration-stone-300 hover:text-indigo-700">
      {source.title ? `${host}: ${source.title}` : host}
    </a>
  );
}
