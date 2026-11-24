import {
  describe,
  expect,
  it
} from 'vitest';

import {
  classifyHostname
} from '../src/lib/websites/hostname';

const base = 'status-available.com';

describe('Hostname routing security', () => {
  it.each([
    base,
    `www.${base}`,
    `app.${base}`,
    `studio.${base}`
  ])('preserves platform host %s', host => {
    expect(classifyHostname(host, base))
      .toEqual({ kind: 'platform' });
  });

  it('resolves a customer hostname', () => {
    expect(
      classifyHostname(`atelier-design.${base}`, base)
    ).toEqual({
      kind: 'customer',
      slug: 'atelier-design'
    });
  });

  it('normalizes hostname case', () => {
    expect(
      classifyHostname(`ATELIER-DESIGN.${base}`, base)
    ).toEqual({
      kind: 'customer',
      slug: 'atelier-design'
    });
  });

  it.each([
    `admin.${base}`,
    `api.${base}`,
    `mail.${base}`,
    `checkout.${base}`,
    `a.${base}`,
    `-invalid.${base}`,
    `invalid-.${base}`,
    `nested.customer.${base}`,
    `${base}.example.com`,
    `fake-${base}`,
    'example.com',
    `customer.${base}/app`,
    `customer.${base}@example.com`,
    `customer.${base},example.com`,
    ''
  ])('rejects unsafe hostname %s', host => {
    expect(classifyHostname(host, base))
      .toEqual({ kind: 'invalid' });
  });

  it('supports isolated development domains', () => {
    expect(
      classifyHostname(
        'test-studio.localhost',
        'localhost'
      )
    ).toEqual({
      kind: 'customer',
      slug: 'test-studio'
    });
  });
});
