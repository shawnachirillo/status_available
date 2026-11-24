'use client';

import { useEffect, useRef, useState } from 'react';
import { editions } from '../../../lib/editions';
import { WebsiteRenderer } from '../../../components/website-renderer';
import {
  palettes,
  type WebsiteDraft
} from '../../../lib/websites/design';


import { validPublicationSlug } from '../../../lib/websites/publication-slug';

type Revision = { id: string; created_at: string };
type CustomerWebsite = {
  id: string;
  name: string;
  edition: string;
  publication_status: string;
  public_slug?: string | null;
  published_draft_version?: string | null;
  published_at?: string | null;
};

type Draft = WebsiteDraft;
const initial: Draft = { edition: 'atelier', business: 'Your studio', headline: 'A quieter kind of bold.', description: 'An independent practice with a point of view.', email: '', phone: '', booking: '', palette: 0 };
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
  const [publishing, setPublishing] = useState(false);
  const [publicationSlug, setPublicationSlug] = useState('');
  const mutationInFlightRef = useRef(false);
  const revisionRequestRef = useRef(0);

  useEffect(() => {
    if (!dirty && !saving && !restoring && !publishing) return;

    function warnBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = '';
    }

    window.addEventListener('beforeunload', warnBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', warnBeforeUnload);
    };
  }, [dirty, saving, restoring, publishing]);

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
    setPublicationSlug('');

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
    if (mutationInFlightRef.current) return;
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

  async function publish() {
    const website = websites.find(w => w.id === websiteId);

    if (
      !website ||
      !websiteId ||
      loadedWebsiteId !== websiteId ||
      selectedWebsiteRef.current !== websiteId ||
      !ready ||
      loadFailed ||
      conflict ||
      dirty ||
      saving ||
      restoring ||
      publishing ||
      mutationInFlightRef.current
    ) return;

    const slug = website.public_slug || publicationSlug;

    if (!validPublicationSlug(slug)) {
      setSaved('Choose a valid website address.');
      return;
    }

    if (
      website.publication_status === 'published' &&
      website.published_draft_version != null &&
      Number(website.published_draft_version) === version
    ) return;

    const requestedId = websiteId;
    const requestedVersion = version;

    mutationInFlightRef.current = true;
    setPublishing(true);
    setSaved('Publishing website...');

    try {
      const response = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          websiteId: requestedId,
          expectedVersion: requestedVersion,
          slug
        })
      });

      const result = await response.json();

      if (selectedWebsiteRef.current !== requestedId) return;

      if (!response.ok) {
        if (
          response.status === 409 &&
          result.error === 'Draft has changed. Refresh before publishing.'
        ) {
          setConflict(true);
          setSaved('Publication conflict: refresh to load the latest saved draft.');
          return;
        }

        if (response.status === 404 || response.status === 403) {
          setLoadFailed(true);
          setSaved('Website access has changed. Refresh to continue.');
          return;
        }

        setSaved(
          typeof result.error === 'string'
            ? result.error
            : 'Unable to publish. Please try again.'
        );
        return;
      }

      if (
        result.published !== true ||
        result.websiteId !== requestedId ||
        result.sourceDraftVersion !== requestedVersion ||
        result.slug !== slug ||
        !validPublicationSlug(result.slug)
      ) {
        throw new Error('Invalid publication response');
      }

      setWebsites(previous => previous.map(item =>
        item.id === requestedId
          ? {
              ...item,
              publication_status: 'published',
              public_slug: result.slug,
              published_draft_version: String(requestedVersion),
              published_at: result.publishedAt
            }
          : item
      ));

      setSaved('Website published successfully.');
    } catch {
      if (selectedWebsiteRef.current === requestedId) {
        setSaved('Publication could not be confirmed. Retry safely or refresh.');
      }
    } finally {
      mutationInFlightRef.current = false;
      setPublishing(false);
    }
  }

  function reset() {
    if (mutationInFlightRef.current) return;
    if (!ready || loadFailed || loadedWebsiteId !== websiteId) return;
    const purchasedEdition = websites.find(w => w.id === websiteId)?.edition;
    setDraft({
      ...initial,
      edition: purchasedEdition ?? draft.edition
    });
    setDirty(true); setSaved('Unsaved changes — click Save draft to keep this reset');
  }
  const edition = editions.find(e => e.slug === draft.edition) ?? editions[0];

  const currentWebsite = websites.find(w => w.id === websiteId);
  const isPublished = currentWebsite?.publication_status === 'published';

  const publicationCurrent =
    isPublished &&
    currentWebsite?.published_draft_version != null &&
    Number(currentWebsite.published_draft_version) === version &&
    !dirty;

  const canPublish =
    Boolean(currentWebsite) &&
    ready &&
    loadedWebsiteId === websiteId &&
    !loadFailed &&
    !conflict &&
    !dirty &&
    !saving &&
    !restoring &&
    !publishing &&
    !publicationCurrent &&
    validPublicationSlug(
      currentWebsite?.public_slug || publicationSlug
    );
  return <main className="shell editor-page">
    <div className="editor-intro"><span className="eyebrow">Edition studio · account workspace</span><h1>Make it yours.</h1><p>Curated choices. A fixed composition. Save your edits, then publish when you are ready.</p><div className="notice">Development workspace: publication is available for testing. Production customer subdomains are not active.</div></div>
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
              disabled={saving || restoring || publishing}
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
          disabled={!ready || loadFailed || loadedWebsiteId !== websiteId || saving || restoring || publishing}
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
        <div className="publication-panel">
          <span className="eyebrow">Publication</span>

          <h2>
            {publicationCurrent
              ? 'Your website is published.'
              : isPublished
                ? 'Update your website.'
                : 'Ready to publish?'}
          </h2>

          {currentWebsite?.public_slug ? (
            <div className="publication-address">
              <span>Website address</span>
              <strong>
                {currentWebsite.public_slug}.status-available.com
              </strong>
            </div>
          ) : (
            <label>
              Website address
              <div className="publication-address-input">
                <input
                  value={publicationSlug}
                  maxLength={63}
                  placeholder="your-studio"
                  autoComplete="off"
                  spellCheck={false}
                  onChange={event =>
                    setPublicationSlug(event.target.value.toLowerCase())
                  }
                />
                <span>.status-available.com</span>
              </div>
            </label>
          )}

          <p className="publication-description">
            {dirty
              ? 'Save your draft before publishing.'
              : publicationCurrent
                ? 'Your saved draft matches the published website.'
                : isPublished
                  ? 'Saved changes are not visible to visitors until you publish.'
                  : 'Publishing creates a separate public version of your saved draft.'}
          </p>

          <div className="editor-actions">
            <button
              type="button"
              disabled={!canPublish}
              onClick={() => { void publish(); }}
            >
              {publishing
                ? 'Publishing...'
                : isPublished
                  ? 'Publish changes'
                  : 'Publish website'}
            </button>
          </div>

          {isPublished &&
            validPublicationSlug(currentWebsite?.public_slug) && (
              <a
                className="publication-preview-link"
                href={'/sites/' + currentWebsite.public_slug}
                target="_blank"
                rel="noopener noreferrer"
              >
                View published test website ↗
              </a>
            )}
        </div>
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
      <section
        className="preview-column"
        aria-label="Live website preview"
      >
        <div className="preview-label">
          <strong>Live preview</strong>
          <span>
            {publicationCurrent
              ? 'Published version'
              : isPublished
                ? 'Draft changes'
                : 'Not published'}
          </span>
        </div>
        <WebsiteRenderer draft={draft} preview />
      </section>
    </div>
  </main>;
}
