// PROTOTYPE - floating variant switcher. Not part of the design being evaluated.
import { useEffect, useState } from 'react';
import { currentSets, historySets, readiness, useStore } from './model/store';

export function PrototypeSwitcher({ variants, current, onChange }: { variants: { key: string; name: string }[]; current: string; onChange: (k: string) => void }) {
  const { state, actions } = useStore();
  const [showState, setShowState] = useState(false);
  const i = Math.max(0, variants.findIndex((v) => v.key === current));
  const go = (d: number) => onChange(variants[(i + d + variants.length) % variants.length].key);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!import.meta.env.DEV) return null;
  const summary = {
    day: state.day,
    target: state.targetId,
    view: state.view,
    readiness: readiness(state),
    canvas: currentSets(state).map((s) => `${s.kind}:${s.status}(${s.cardIds.length})`),
    history: historySets(state).length,
    proposed: state.proposed.length,
    approved: state.approvedCount,
    focus: state.focus?.cardId ?? null,
  };

  return (
    <div className="fixed bottom-5 left-1/2 z-[1000] -translate-x-1/2 font-mono">
      {showState && (
        <pre className="mb-2 max-w-[460px] overflow-auto rounded-xl bg-black/90 p-3 text-[11px] leading-relaxed text-lime-300 shadow-2xl">{JSON.stringify(summary, null, 1)}</pre>
      )}
      <div className="flex items-center gap-1 rounded-full bg-black px-2 py-1.5 text-[12px] text-white shadow-[0_8px_30px_rgba(0,0,0,.35)] ring-2 ring-lime-400/70">
        <span className="px-2 text-[10px] uppercase tracking-wider text-lime-400">prototype</span>
        <button className="rounded-full px-2 py-0.5 hover:bg-white/15" onClick={() => go(-1)}>←</button>
        <span className="min-w-[170px] text-center">{variants[i].key} · {variants[i].name}</span>
        <button className="rounded-full px-2 py-0.5 hover:bg-white/15" onClick={() => go(1)}>→</button>
        <span className="mx-1 h-4 w-px bg-white/25" />
        <button className="rounded-full px-2 py-0.5 hover:bg-white/15" title="Симулировать новый день" onClick={actions.newDay}>☀ новый день</button>
        <button className={`rounded-full px-2 py-0.5 hover:bg-white/15 ${showState ? 'text-lime-300' : ''}`} onClick={() => setShowState((x) => !x)}>{'{ }'}</button>
      </div>
    </div>
  );
}
