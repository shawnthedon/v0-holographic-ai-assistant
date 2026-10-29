'use client';

import { useEffect, useMemo, useRef } from 'react';
import { animate } from 'animejs';
import { CAPABILITY_BY_ID, capabilitiesIn } from '@/lib/agent-studio/catalogue';
import {
  AVAILABILITY_META,
  CATEGORY_META,
  type AgentDraft,
  type StudioCategory,
  type ValidationResult,
} from '@/lib/agent-studio/types';
import { useReducedMotion } from '@/lib/hud/motion';

/**
 * The composition map.
 *
 * Eight category slots orbit one core. An edge exists only where the catalogue
 * declares a real dependency, so the picture of "what is wired to what" is the
 * same thing validation checks — no decorative lines.
 *
 * Every node is a real `<button>` with a label and an availability word, so the
 * diagram is usable with a keyboard and a screen reader; the SVG underneath is
 * `aria-hidden`.
 */

const SLOTS: Array<{ category: StudioCategory; x: number; y: number }> = [
  { category: 'framework', x: 50, y: 14 },
  { category: 'model', x: 79, y: 26 },
  { category: 'memory', x: 88, y: 50 },
  { category: 'behaviour', x: 79, y: 76 },
  { category: 'permissions', x: 50, y: 88 },
  { category: 'knowledge', x: 22, y: 76 },
  { category: 'tools', x: 12, y: 50 },
  { category: 'interaction', x: 22, y: 26 },
];

const TONE_STROKE: Record<'ok' | 'warn' | 'bad' | 'idle', string> = {
  ok: 'rgba(182,255,59,0.55)',
  warn: 'rgba(255,210,122,0.55)',
  bad: 'rgba(255,157,122,0.6)',
  idle: 'rgba(125,242,255,0.22)',
};

export interface StudioGraphProps {
  draft: AgentDraft;
  validation: ValidationResult;
  activeCategory: StudioCategory;
  onSelectCategory: (category: StudioCategory) => void;
}

export function StudioGraph({ draft, validation, activeCategory, onSelectCategory }: StudioGraphProps) {
  const reduced = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);

  const nodes = useMemo(
    () =>
      SLOTS.map((slot) => {
        const selected = Object.keys(draft.selected)
          .map((id) => CAPABILITY_BY_ID[id])
          .filter((capability) => capability && capability.category === slot.category);
        const primary = selected[0];
        const accent = AVAILABILITY_META[primary ? validation.verdicts[primary.id]?.availability ?? primary.availability : 'check-required'];
        return {
          ...slot,
          selected,
          primary,
          usable: primary ? validation.verdicts[primary.id]?.usable ?? false : false,
          tone: primary ? accent.tone : ('idle' as const),
          label: primary?.name ?? CATEGORY_META[slot.category].label,
          sublabel: primary ? accent.label : 'not set',
        };
      }),
    [draft.selected, validation.verdicts],
  );

  const edges = useMemo(() => {
    const lines: Array<{ id: string; x1: number; y1: number; x2: number; y2: number; dependency: boolean; tone: string }> = [];
    const byCategory = new Map<StudioCategory, (typeof nodes)[number]>();
    nodes.forEach((node) => byCategory.set(node.category, node));

    for (const node of nodes) {
      if (!node.primary) continue;
      lines.push({
        id: `core-${node.category}`,
        x1: 50,
        y1: 51,
        x2: node.x,
        y2: node.y,
        dependency: false,
        tone: node.usable ? 'rgba(182,255,59,0.35)' : 'rgba(125,242,255,0.18)',
      });
    }

    /* real dependencies only: capability.requires that is also selected */
    for (const node of nodes) {
      if (!node.primary) continue;
      for (const requirement of node.primary.requires) {
        const capability = CAPABILITY_BY_ID[requirement];
        if (!capability) continue;
        const target = byCategory.get(capability.category);
        if (!target || !target.primary) continue;
        lines.push({
          id: `${node.category}->${target.category}:${requirement}`,
          x1: node.x,
          y1: node.y,
          x2: target.x,
          y2: target.y,
          dependency: true,
          tone: validation.verdicts[node.primary.id]?.usable ? 'rgba(46,242,192,0.42)' : 'rgba(255,157,122,0.35)',
        });
      }
    }
    return lines;
  }, [nodes, validation.verdicts]);

  /* nodes arrive in sequence — one reveal, not a loop */
  useEffect(() => {
    if (reduced || !containerRef.current) return;
    const targets = containerRef.current.querySelectorAll('.studio-node');
    if (targets.length === 0) return;
    const animation = animate(targets, {
      opacity: [0, 1],
      scale: [0.92, 1],
      /* anime v4 wants the full three-argument signature for a function value */
      delay: ((_target: Element, index: number) => 30 + index * 34) as unknown as never,
      duration: 420,
      ease: 'outExpo',
    });
    return () => {
      animation.pause();
    };
  }, [reduced]);

  return (
    <div ref={containerRef} className="relative h-full min-h-[420px] w-full" aria-label="Composition map">
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <radialGradient id="studio-core-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(46,242,192,0.22)" />
            <stop offset="100%" stopColor="rgba(46,242,192,0)" />
          </radialGradient>
        </defs>
        <circle cx="50" cy="51" r="30" fill="url(#studio-core-glow)" />
        <circle cx="50" cy="51" r="30" fill="none" stroke="rgba(125,242,255,0.10)" strokeDasharray="1 2" />
        {edges.map((edge) => {
          const mx = (edge.x1 + edge.x2) / 2;
          const my = (edge.y1 + edge.y2) / 2 - (edge.dependency ? 4 : 10);
          return (
            <path
              key={edge.id}
              d={`M ${edge.x1} ${edge.y1} Q ${mx} ${my} ${edge.x2} ${edge.y2}`}
              fill="none"
              stroke={edge.tone}
              strokeWidth={edge.dependency ? 0.22 : 0.16}
              strokeDasharray={edge.dependency ? undefined : '0.7 1.4'}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
        <circle cx="50" cy="51" r="1.1" fill="rgba(125,242,255,0.55)" />
      </svg>

      {/* core */}
      <div
        className="absolute -translate-x-1/2 -translate-y-1/2 text-center"
        style={{ left: '50%', top: '51%' }}
      >
        <div
          className={`hud-panel flex h-[86px] w-[132px] flex-col items-center justify-center gap-1 px-2 ${
            validation.activatable
              ? 'border-[color:var(--hud-lime)]/45'
              : validation.blockers.length
                ? 'border-[#ff9d7a]/45'
                : 'border-[color:var(--hud-line-strong)]'
          }`}
        >
          <span className="font-mono text-[6px] uppercase tracking-[0.3em] text-[color:var(--hud-ink-dim)]">
            agent core
          </span>
          <span className="line-clamp-2 px-1 text-center font-mono text-[8px] uppercase leading-[1.35] tracking-[0.14em] text-[color:var(--hud-ink)]">
            {draft.name || 'untitled'}
          </span>
          <span
            className={`font-mono text-[6px] uppercase tracking-[0.24em] ${
              validation.activatable ? 'text-[color:var(--hud-lime)]' : 'text-[#ffd27a]'
            }`}
          >
            {validation.activatable ? 'activatable' : `${validation.blockers.length} blocked`}
          </span>
        </div>
      </div>

      {/* category nodes */}
      {nodes.map((node) => {
        const meta = AVAILABILITY_META[node.primary ? validation.verdicts[node.primary.id]?.availability ?? node.primary.availability : 'check-required'];
        const active = activeCategory === node.category;
        return (
          <button
            key={node.category}
            type="button"
            onClick={() => onSelectCategory(node.category)}
            aria-label={`${CATEGORY_META[node.category].label}: ${node.label} — ${node.sublabel}`}
            aria-pressed={active}
            className={`studio-node absolute flex w-[124px] -translate-x-1/2 -translate-y-1/2 flex-col gap-[3px] rounded border px-2 py-1.5 text-left transition ${
              active
                ? 'border-[color:var(--hud-ink)] bg-[#04141a]/95'
                : 'border-[color:var(--hud-line)] bg-[#030c10]/88 hover:border-[color:var(--hud-line-strong)]'
            }`}
            style={{ left: `${node.x}%`, top: `${node.y}%` }}
          >
            <span className="flex items-center justify-between gap-1 font-mono text-[5.5px] uppercase tracking-[0.24em] text-[color:var(--hud-ink-dim)]">
              {CATEGORY_META[node.category].short}
              <span
                aria-hidden="true"
                style={{
                  color:
                    meta.tone === 'ok'
                      ? 'var(--hud-lime)'
                      : meta.tone === 'warn'
                        ? '#ffd27a'
                        : meta.tone === 'bad'
                          ? '#ff9d7a'
                          : 'var(--hud-ink-dim)',
                }}
              >
                {meta.glyph}
              </span>
            </span>
            <span className="truncate font-mono text-[8px] tracking-[0.08em] text-[color:var(--hud-ink)]">
              {node.label}
            </span>
            <span
              className="font-mono text-[5.5px] uppercase tracking-[0.2em]"
              style={{
                color:
                  meta.tone === 'ok'
                    ? 'var(--hud-lime)'
                    : meta.tone === 'warn'
                      ? '#ffd27a'
                      : meta.tone === 'bad'
                        ? '#ff9d7a'
                        : 'var(--hud-ink-dim)',
              }}
            >
              {node.sublabel}
            </span>
            {node.selected.length > 1 && (
              <span className="font-mono text-[5.5px] uppercase tracking-[0.2em] text-[color:var(--hud-ink-dim)]">
                +{node.selected.length - 1} more
              </span>
            )}
          </button>
        );
      })}

      {/* the accessible alternative: the same map, as a list */}
      <ul className="sr-only">
        {capabilitiesIn('framework').length > 0 &&
          SLOTS.map((slot) => (
            <li key={`sr-${slot.category}`}>
              {CATEGORY_META[slot.category].label}:{' '}
              {Object.keys(draft.selected)
                .map((id) => CAPABILITY_BY_ID[id])
                .filter((capability) => capability?.category === slot.category)
                .map((capability) => capability!.name)
                .join(', ') || 'not set'}
            </li>
          ))}
      </ul>
    </div>
  );
}
