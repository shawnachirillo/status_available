import {
  validPublicationSlug
} from './publication-slug';

export type HostDestination =
  | { kind: 'platform' }
  | { kind: 'customer'; slug: string }
  | { kind: 'invalid' };

export function classifyHostname(
  hostname: string,
  baseDomain: string
): HostDestination {
  const host = hostname.toLowerCase();
  const base = baseDomain.toLowerCase();

  if (
    !base ||
    !/^[a-z0-9.-]+$/.test(host) ||
    !/^[a-z0-9.-]+$/.test(base)
  ) {
    return { kind: 'invalid' };
  }

  if (
    host === base ||
    host === `www.${base}` ||
    host === `app.${base}` ||
    host === `studio.${base}`
  ) {
    return { kind: 'platform' };
  }

  if (!host.endsWith(`.${base}`)) {
    return { kind: 'invalid' };
  }

  const slug = host.slice(
    0,
    -(base.length + 1)
  );

  if (!validPublicationSlug(slug)) {
    return { kind: 'invalid' };
  }

  return { kind: 'customer', slug };
}
