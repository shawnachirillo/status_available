const reserved = new Set([
  'www', 'app', 'studio', 'api',
  'admin', 'auth', 'mail', 'status',
  'support', 'help', 'assets', 'cdn',
  'preview', 'billing', 'checkout',
  'dashboard', 'account', 'static'
]);

export function validPublicationSlug(
  value: unknown
): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 3 &&
    value.length <= 63 &&
    /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value) &&
    !reserved.has(value)
  );
}
