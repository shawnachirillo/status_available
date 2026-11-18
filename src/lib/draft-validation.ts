import { editions } from './editions';

type Draft = {
  edition: string;
  business: string;
  headline: string;
  description: string;
  email: string;
  phone: string;
  booking: string;
  palette: number;
};

export function validDraft(value: unknown): value is Draft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const d = value as Record<string, unknown>;

  return (
    typeof d.edition === 'string' &&
    editions.some(e => e.slug === d.edition) &&
    typeof d.business === 'string' && d.business.length <= 70 &&
    typeof d.headline === 'string' && d.headline.length <= 110 &&
    typeof d.description === 'string' && d.description.length <= 420 &&
    typeof d.email === 'string' && d.email.length <= 254 &&
    typeof d.phone === 'string' && d.phone.length <= 25 &&
    typeof d.booking === 'string' && d.booking.length <= 2048 &&
    Number.isInteger(d.palette) && (d.palette as number) >= 0 && (d.palette as number) <= 2
  );
}

