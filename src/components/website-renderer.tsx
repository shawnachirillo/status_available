import { getEdition } from '../lib/editions';

import {
  palettes,
  safeHref,
  type WebsiteDraft
} from '../lib/websites/design';

export function WebsiteRenderer({
  draft,
  preview = false
}: {
  draft: WebsiteDraft;
  preview?: boolean;
}) {
  const edition = getEdition(draft.edition);

  if (!edition) {
    return null;
  }

  const chosen = palettes[draft.palette] ?? palettes[0];
  const colors = chosen.background ? chosen : edition;

  const email = safeHref('email', draft.email);
  const phone = safeHref('phone', draft.phone);
  const booking = safeHref('booking', draft.booking);

  const Heading = preview ? 'h2' : 'h1';

  return (
    <div
      className="website-preview"
      style={{
        background: colors.background,
        color: colors.foreground
      }}
    >
      <div className="preview-top">
        <span>{draft.business || 'Your studio'}</span>
        <span>{edition.category}</span>
      </div>

      <div className="preview-body">
        <span className="preview-kicker">
          {edition.name} / {edition.tier}
        </span>

        <Heading>
          {draft.headline || 'Your headline'}
        </Heading>

        <p>
          {draft.description ||
            'Your introduction goes here.'}
        </p>

        <div
          className="preview-accent"
          style={{ background: colors.accent }}
          aria-hidden="true"
        />
      </div>

      <div className="preview-bottom">
        {email && <a href={email}>Email</a>}
        {phone && <a href={phone}>Call</a>}
        {booking && (
          <a
            href={booking}
            target="_blank"
            rel="noopener noreferrer"
          >
            Book
          </a>
        )}
      </div>
    </div>
  );
}
