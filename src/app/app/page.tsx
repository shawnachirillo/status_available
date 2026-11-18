'use client';

import { useEffect, useState } from 'react';
import { editions } from '../../lib/editions';

type Draft = { edition: string; business: string; headline: string; description: string; email: string; phone: string; booking: string; palette: number };

const palettes = [
  { label: 'Edition original', background: '', foreground: '', accent: '' },
  { label: 'Ink / Ivory', background: '#f2eee5', foreground: '#23201d', accent: '#b56a43' },
  { label: 'Clay / Plum', background: '#e9d6c9', foreground: '#482b39', accent: '#995c60' },
];
const initial: Draft = { edition: 'atelier', business: 'Your studio', headline: 'A quieter kind of bold.', description: 'An independent practice with a point of view.', email: '', phone: '', booking: '', palette: 0 };
function safeHref(kind: 'email'|'phone'|'booking', value: string) {
  if (!value.trim()) return null;
  if (kind === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? `mailto:${value}` : null;
  if (kind === 'phone') return /^[+\d()\s.-]{7,25}$/.test(value) ? `tel:${value.replace(/[^+\d]/g,'')}` : null;
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}
export default function CustomerArea() {
  const [draft, setDraft] = useState<Draft>(initial);
  const [ready, setReady] = useState(false);
  const [saved, setSaved] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const response = await fetch('/api/draft', { cache: 'no-store' });
        if (!response.ok) throw new Error('Cloud draft unavailable');

        const data = await response.json();
        if (active && data.draft && editions.some(e => e.slug === data.draft.edition)) {
          setDraft({ ...initial, ...data.draft });
          setSaved('Cloud draft loaded');
        }
      } catch {
        if (active) setSaved('Unable to load cloud draft');
      } finally {
        if (active) setReady(true);
      }
    }

    void load();
    return () => { active = false; };
  }, []);

  function change<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft(d => ({ ...d, [key]: value }));
    setSaved('Unsaved changes');
  }

  async function save() {
    if (!ready || saving) return;

    setSaving(true);
    setSaved('Saving...');

    try {
      const response = await fetch('/api/draft', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });

      if (!response.ok) throw new Error('Save failed');
      setSaved('Saved to your account');
    } catch {
      setSaved('Unable to save. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    setDraft(initial);
    setSaved('Unsaved changes — click Save draft to keep this reset');
  }
  const edition = editions.find(e => e.slug === draft.edition) ?? editions[0];
  const chosen = palettes[draft.palette] ?? palettes[0];
  const colors = chosen.background ? chosen : edition;
  return <main className="shell editor-page">
    <div className="editor-intro"><span className="eyebrow">Edition studio · account workspace</span><h1>Make it yours.</h1><p>Curated choices. A fixed composition. Preview your edits before publishing becomes available.</p><div className="notice">Development workspace: drafts are saved to your account. Purchases and live publishing are not yet available.</div></div>
    <div className="editor-grid">
      <section className="editor-controls" aria-label="Website settings">
        <label>Edition<select value={draft.edition} onChange={e => { const next = editions.find(x => x.slug === e.target.value)!; setDraft(d => ({...d, edition: next.slug, headline: next.displayTitle, palette: 0})); setSaved('Unsaved changes'); }}>{editions.map(e => <option key={e.slug} value={e.slug}>{e.name} — {e.tier}</option>)}</select></label>
        <label>Business name<input maxLength={70} value={draft.business} onChange={e => change('business', e.target.value)} /></label>
        <label>Headline<input maxLength={110} value={draft.headline} onChange={e => change('headline', e.target.value)} /></label>
        <label>Introduction<textarea rows={4} maxLength={420} value={draft.description} onChange={e => change('description', e.target.value)} /></label>
        <label>Approved colorway<select value={draft.palette} onChange={e => change('palette', Number(e.target.value))}>{palettes.map((p,i) => <option key={i} value={i}>{p.label}</option>)}</select></label>
        <label>Email (optional)<input type="email" value={draft.email} onChange={e => change('email', e.target.value)} placeholder="hello@example.com" /></label>
        <label>Phone (optional)<input type="tel" value={draft.phone} onChange={e => change('phone', e.target.value)} placeholder="+1 555 555 5555" /></label>
        <label>External booking URL (optional)<input type="url" value={draft.booking} onChange={e => change('booking', e.target.value)} placeholder="https://example.com/book" /></label>
        <div className="editor-actions"><button type="button" onClick={save} disabled={!ready || saving}>Save draft</button><button type="button" className="secondary-action" onClick={reset}>Reset draft</button></div>
        <p className="editor-status" role="status">{saved || 'Changes appear immediately in the preview.'}</p>
      </section>
      <section className="preview-column" aria-label="Live website preview"><div className="preview-label"><strong>Live preview</strong><span>Not published</span></div><div className="website-preview" style={{background: colors.background, color: colors.foreground}}>
        <div className="preview-top"><span>{draft.business || 'Your studio'}</span><span>{edition.category}</span></div>
        <div className="preview-body"><span className="preview-kicker">{edition.name} / {edition.tier}</span><h2>{draft.headline || 'Your headline'}</h2><p>{draft.description || 'Your introduction goes here.'}</p><div className="preview-accent" style={{background: colors.accent}} /></div>
        <div className="preview-bottom">{safeHref('email',draft.email) && <a href={safeHref('email',draft.email)!}>Email</a>}{safeHref('phone',draft.phone) && <a href={safeHref('phone',draft.phone)!}>Call</a>}{safeHref('booking',draft.booking) && <a href={safeHref('booking',draft.booking)!} target="_blank" rel="noopener noreferrer">Book</a>}</div>
      </div></section>
    </div>
  </main>;
}
