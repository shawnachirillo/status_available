export type WebsiteDraft = {
  edition: string;
  business: string;
  headline: string;
  description: string;
  email: string;
  phone: string;
  booking: string;
  palette: number;
};

export const palettes = [
  {
    label: 'Edition original',
    background: '',
    foreground: '',
    accent: ''
  },
  {
    label: 'Ink / Ivory',
    background: '#f2eee5',
    foreground: '#23201d',
    accent: '#b56a43'
  },
  {
    label: 'Clay / Plum',
    background: '#e9d6c9',
    foreground: '#482b39',
    accent: '#995c60'
  }
];

export function safeHref(
  kind: 'email' | 'phone' | 'booking',
  value: string
): string | null {
  if (!value.trim()) return null;

  if (kind === 'email') {
    return /^[^\s@?&#%]+@[^\s@?&#%]+\.[^\s@?&#%]+$/.test(value)
      ? `mailto:${value}`
      : null;
  }

  if (kind === 'phone') {
    if (!/^\+?[\d()\s.-]{7,25}$/.test(value)) {
      return null;
    }

    const normalized = value.replace(/[^\d+]/g, '');

    return /^\+?\d{7,15}$/.test(normalized)
      ? `tel:${normalized}`
      : null;
  }

  try {
    const url = new URL(value);

    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password
    ) {
      return null;
    }

    return url.href;
  } catch {
    return null;
  }
}

export function publicationContent(
  draft: WebsiteDraft
): WebsiteDraft {
  return {
    edition: draft.edition,
    business: draft.business,
    headline: draft.headline,
    description: draft.description,
    email: draft.email,
    phone: draft.phone,
    booking: draft.booking,
    palette: draft.palette
  };
}
