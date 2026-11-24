'use client';

import { useEffect, useRef, useState } from 'react';
import { editions } from '../../lib/editions';

type Revision = { id: string; created_at: string };
type CustomerWebsite = {
  id: string;
  name: string;
  edition: string;
  publication_status: string;
};

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
  const [websites, setWebsites] = useState<CustomerWebsite[]>([]);
  const [websiteId, setWebsiteId] = useState('');
  const [dirty, setDirty] = useState(false);
  const selectedWebsiteRef = useRef('');
  const [loadedWebsiteId, setLoadedWebsiteId] = useState('');
  const [websitesReady, setWebsitesReady] = useState(false);
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saved, setSaved] = useState('');
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState(0);
  const [conflict, setConflict] = useState(false);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [selectedRevision, setSelectedRevision] = useState('');
  const [restoring, setRestoring] = useState(false);
  const mutationInFlightRef = useRef(false);
  const revisionRequestRef = useRef(0);

  useEffect(() => {
    if (!dirty && !saving && !restoring) return;

    function warnBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = '';
    }

    window.addEventListener('beforeunload', warnBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', warnBeforeUnload);
    };
  }, [dirty, saving, restoring]);

  async function loadRevisions() {
    const requestedId = websiteId;
    const requestNumber = ++revisionRequestRef.current;
    if (!requestedId || loadedWebsiteId !== requestedId ||
        selectedWebsiteRef.current !== requestedId) return;
    try {
      const response = await fetch('/api/draft/revisions?websiteId=' + encodeURIComponent(websiteId), {
        cache: 'no-store'
      });

      if (!response.ok) throw new Error('Unable to load history');

      const data = await response.json();
      if (
        selectedWebsiteRef.current === requestedId &&
        revisionRequestRef.current === requestNumber
      ) {
        setRevisions(data.revisions ?? []);
      }
    } catch {
      if (
        selectedWebsiteRef.current === requestedId &&
        revisionRequestRef.current === requestNumber
      ) {
        setSaved('Unable to load version history');
      }
    }
  }

  async function restoreRevision() {
    if (!websiteId || loadedWebsiteId !== websiteId || selectedWebsiteRef.current !== websiteId || !ready || loadFailed || conflict || !selectedRevision || restoring || saving) return;

    if (!window.confirm(
      'Restore this version? Your current draft will be replaced, and the restored version will be saved in history.'
    )) return;

    if (mutationInFlightRef.current) return;
    mutationInFlightRef.current = true;
    const requestedId = websiteId;
    setRestoring(true);
    setSaved('Restoring version...');

    try {
      const response = await fetch('/api/draft/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ websiteId, revisionId: selectedRevision, expectedVersion: version })
      });

      if (selectedWebsiteRef.current !== requestedId) return;
      if (response.status === 409) {
        setConflict(true);
        setSaved('Restore conflict: another tab has saved a newer version. Your edits are still here. Copy any changes you want to keep before refreshing.');
        return;
      }
      if (!response.ok) throw new Error('Restore failed');

      const data = await response.json();
      if (selectedWebsiteRef.current !== requestedId) return;
      setDraft(data.draft);
      setVersion(data.version);
      setConflict(false);
      setDirty(false); setSaved('Previous version restored');
      await loadRevisions();
    } catch {
      if (selectedWebsiteRef.current === requestedId) {
        setSaved('Unable to restore version');
      }
    } finally {
      mutationInFlightRef.current = false;
      setRestoring(false);
    }
  }

  useEffect(() => {
    let active = true;

    async function loadWebsites() {
      try {
        const response = await fetch('/api/websites', { cache: 'no-store' });
        if (!response.ok) throw new Error('Website list unavailable');
        const data = await response.json();
        if (!Array.isArray(data.websites)) throw new Error('Invalid website list');
        if (!active) return;
        const firstId = data.websites[0]?.id ?? '';
        selectedWebsiteRef.current = firstId;
        setWebsites(data.websites);
        setWebsiteId(firstId);
        if (data.websites.length === 0) {
          setSaved('No eligible purchased website found.');
        }
      } catch {
        if (active) {
          setLoadFailed(true);
          setSaved('Unable to load your purchased websites.');
        }
      } finally {
        if (active) setWebsitesReady(true);
      }
    }

    void loadWebsites();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!websitesReady || !websiteId) return;
    let active = true;

    setReady(false);
    setLoadedWebsiteId('');
    setLoadFailed(false);
    setConflict(false);
    setRevisions([]);
    setSelectedRevision('');
    setDraft(initial);
    setVersion(0);

    async function load() {
      try {
        const response = await fetch('/api/draft?websiteId=' + encodeURIComponent(websiteId), { cache: 'no-store' });
        if (!response.ok) throw new Error('Cloud draft unavailable');

        const data = await response.json();
        if (!Number.isSafeInteger(data.version) || data.version < 0) {
          throw new Error('Invalid cloud version');
        }
        if (data.draft !== null && (
          !data.draft ||
          !editions.some(e => e.slug === data.draft.edition)
        )) {
          throw new Error('Invalid cloud draft');
        }
        if (active && selectedWebsiteRef.current === websiteId) {
          setVersion(data.version);
          setLoadedWebsiteId(websiteId);
        }
        if (active && selectedWebsiteRef.current === websiteId &&
            data.draft && editions.some(e => e.slug === data.draft.edition)) {
          setDraft({ ...initial, ...data.draft });
          setSaved('Cloud draft loaded');
        }
      } catch {
        if (active && selectedWebsiteRef.current === websiteId) {
          setLoadFailed(true);
          setSaved('Unable to load cloud draft. Saving is disabled to protect your existing work. Refresh to retry.');
        }
      } finally {
        if (active) setReady(true);
      }
    }

    void load();
    return () => { active = false; };
  }, [websiteId, websitesReady]);

  function change<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft(d => ({ ...d, [key]: value }));
    setDirty(true); setSaved('Unsaved changes');
  }

  async function save() {
    if (!websiteId || loadedWebsiteId !== websiteId || selectedWebsiteRef.current !== websiteId || !ready || loadFailed || saving || restoring || conflict) return;

    if (mutationInFlightRef.current) return;
    mutationInFlightRef.current = true;
    const requestedId = websiteId;
    setSaving(true);
    setSaved('Saving...');

    try {
      const response = await fetch('/api/draft', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ websiteId, draft, expectedVersion: version }),
      });

      if (selectedWebsiteRef.current !== requestedId) return;
      if (response.status === 409) {
        setConflict(true);
        setSaved('Save conflict: another tab has saved a newer version. Your edits are still here. Copy any changes you want to keep before refreshing.');
        return;
      }
      if (!response.ok) throw new Error('Save failed');
      const result = await response.json();
      if (selectedWebsiteRef.current !== requestedId) return;
      setVersion(result.version);
      setDirty(false); setSaved('Saved to your account');
      void loadRevisions();
    } catch {
      if (selectedWebsiteRef.current === requestedId) {
        setSaved('Unable to save. Please try again.');
      }
    } finally {
      mutationInFlightRef.current = false;
      setSaving(false);
    }
  }

  function reset() {
    if (!ready || loadFailed || loadedWebsiteId !== websiteId) return;
    const purchasedEdition = websites.find(w => w.id === websiteId)?.edition;
    setDraft({
      ...initial,
      edition: purchasedEdition ?? draft.edition
    });
    setDirty(true); setSaved('Unsaved changes — click Save draft to keep this reset');
  }
  const edition = editions.find(e => e.slug === draft.edition) ?? editions[0];
  const chosen = palettes[draft.palette] ?? palettes[0];
  const colors = chosen.background ? chosen : edition;
  return <main className="shell editor-page">
    <div className="editor-intro"><span className="eyebrow">Edition studio · account workspace</span><h1>Make it yours.</h1><p>Curated choices. A fixed composition. Preview your edits before publishing becomes available.</p><div className="notice">Development workspace: drafts are saved to your account. Purchases and live publishing are not yet available.</div></div>
    <div className="editor-grid">
      {websites.length > 1 && (
        <div className="website-selector">
          <label>
            Your websites
            <select
              value={websiteId}
              onChange={event => {
                if (mutationInFlightRef.current) return;
                if (dirty && !window.confirm(
                  'You have unsaved changes. Switch websites and discard them?'
                )) return;
                setDirty(false);
                selectedWebsiteRef.current = event.target.value;
                revisionRequestRef.current += 1;
                setReady(false);
                setLoadedWebsiteId('');
                setWebsiteId(event.target.value);
              }}
              disabled={saving || restoring}
            >
              {websites.map(website => (
                <option key={website.id} value={website.id}>
                  {website.name} — {website.edition}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <section className="editor-controls" aria-label="Website settings">
        <fieldset
          disabled={!ready || loadFailed || loadedWebsiteId !== websiteId || saving || restoring}
          style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}
        >
        <label>Purchased Edition<input value={edition.name} readOnly /></label>
        <label>Business name<input maxLength={70} value={draft.business} onChange={e => change('business', e.target.value)} /></label>
        <label>Headline<input maxLength={110} value={draft.headline} onChange={e => change('headline', e.target.value)} /></label>
        <label>Introduction<textarea rows={4} maxLength={420} value={draft.description} onChange={e => change('description', e.target.value)} /></label>
        <label>Approved colorway<select value={draft.palette} onChange={e => change('palette', Number(e.target.value))}>{palettes.map((p,i) => <option key={i} value={i}>{p.label}</option>)}</select></label>
        <label>Email (optional)<input type="email" value={draft.email} onChange={e => change('email', e.target.value)} placeholder="hello@example.com" /></label>
        <label>Phone (optional)<input type="tel" value={draft.phone} onChange={e => change('phone', e.target.value)} placeholder="+1 555 555 5555" /></label>
        <label>External booking URL (optional)<input type="url" value={draft.booking} onChange={e => change('booking', e.target.value)} placeholder="https://example.com/book" /></label>
        <div className="editor-actions"><button type="button" onClick={save} disabled={!websiteId || !ready || loadFailed || saving || restoring || conflict}>Save draft</button><button type="button" className="secondary-action" onClick={reset}>Reset draft</button></div>
        <div className="version-history">
          <label>
            Version history
            <select
              value={selectedRevision}
              onFocus={() => { void loadRevisions(); }}
              onChange={e => setSelectedRevision(e.target.value)}
            >
              <option value="">Select a saved version</option>
              {revisions.map(revision => (
                <option key={revision.id} value={revision.id}>
                  {new Date(revision.created_at).toLocaleString()}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="secondary-action"
            disabled={!websiteId || !selectedRevision || restoring || saving || !ready || loadFailed || conflict}
            onClick={() => { void restoreRevision(); }}
          >
            {restoring ? 'Restoring...' : 'Restore selected version'}
          </button>
        </div>
        <p className="editor-status" role="status">{saved || 'Changes appear immediately in the preview.'}</p>
        </fieldset>
      </section>
      <section className="preview-column" aria-label="Live website preview"><div className="preview-label"><strong>Live preview</strong><span>Not published</span></div><div className="website-preview" style={{background: colors.background, color: colors.foreground}}>
        <div className="preview-top"><span>{draft.business || 'Your studio'}</span><span>{edition.category}</span></div>
        <div className="preview-body"><span className="preview-kicker">{edition.name} / {edition.tier}</span><h2>{draft.headline || 'Your headline'}</h2><p>{draft.description || 'Your introduction goes here.'}</p><div className="preview-accent" style={{background: colors.accent}} /></div>
        <div className="preview-bottom">{safeHref('email',draft.email) && <a href={safeHref('email',draft.email)!}>Email</a>}{safeHref('phone',draft.phone) && <a href={safeHref('phone',draft.phone)!}>Call</a>}{safeHref('booking',draft.booking) && <a href={safeHref('booking',draft.booking)!} target="_blank" rel="noopener noreferrer">Book</a>}</div>
      </div></section>
    </div>
  </main>;
}
