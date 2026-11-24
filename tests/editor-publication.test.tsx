// @vitest-environment jsdom

import React from 'react';
import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react';

import CustomerArea from '../src/app/(platform)/app/page';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const draft = {
  edition: 'atelier',
  business: 'Example Studio',
  headline: 'Independent by design.',
  description: 'A creative practice.',
  email: '',
  phone: '',
  booking: '',
  palette: 0
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

type Payload = {
  websiteId: string;
  expectedVersion: number;
  slug: string;
};

function success(payload: Payload) {
  return json({
    published: true,
    websiteId: payload.websiteId,
    slug: payload.slug,
    sourceDraftVersion: payload.expectedVersion,
    publicationVersion: 1,
    publicationId: 'publication-test',
    publishedAt: '2026-11-24T12:00:00Z',
    unchanged: false
  });
}

function setup(options: {
  published?: boolean;
  publishedVersion?: string;
  respond?: (payload: Payload) => Response | Promise<Response>;
} = {}) {
  const requests: Payload[] = [];
  let version = 4;

  vi.stubGlobal('fetch', vi.fn(async (
    input: RequestInfo | URL,
    init?: RequestInit
  ) => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname === '/api/websites') {
      return json({
        websites: [
          {
            id: A,
            name: 'Website A',
            edition: 'atelier',
            publication_status:
              options.published ? 'published' : 'draft',
            public_slug:
              options.published ? 'example-studio' : null,
            published_draft_version:
              options.published
                ? options.publishedVersion ?? '4'
                : null
          },
          {
            id: B,
            name: 'Website B',
            edition: 'atelier',
            publication_status: 'draft'
          }
        ]
      });
    }

    if (url.pathname === '/api/draft/revisions') {
      return json({
        websiteId: url.searchParams.get('websiteId'),
        revisions: []
      });
    }

    if (url.pathname === '/api/draft') {
      if (init?.method === 'PUT') {
        const payload = JSON.parse(String(init.body));
        version += 1;

        return json({
          saved: true,
          websiteId: payload.websiteId,
          version
        });
      }

      return json({
        websiteId: url.searchParams.get('websiteId'),
        draft,
        version
      });
    }

    if (url.pathname === '/api/publish') {
      const payload = JSON.parse(String(init?.body));
      requests.push(payload);

      return options.respond
        ? options.respond(payload)
        : success(payload);
    }

    throw new Error('Unexpected request: ' + url.href);
  }));

  render(<CustomerArea />);
  return requests;
}

async function loaded() {
  const business = await screen.findByLabelText(
    'Business name'
  ) as HTMLInputElement;

  await waitFor(() => {
    expect(business.value).toBe(draft.business);
    expect(business.matches(':disabled')).toBe(false);
  });

  return business;
}

function address(value: string) {
  fireEvent.change(
    screen.getByPlaceholderText('your-studio'),
    { target: { value } }
  );
}

function publishButton() {
  return screen.getByRole('button', {
    name: /^publish website$/i
  }) as HTMLButtonElement;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Customer publication interface', () => {
  it('rejects invalid and reserved addresses', async () => {
    const requests = setup();
    await loaded();

    for (const slug of ['', 'ab', 'www', 'admin', 'a--b', 'a b']) {
      address(slug);
      expect(publishButton().disabled).toBe(true);
    }

    expect(requests).toHaveLength(0);

    address('example-studio');
    expect(publishButton().disabled).toBe(false);
  });

  it('requires saving unsaved changes before publishing', async () => {
    const requests = setup();
    const business = await loaded();

    address('example-studio');

    fireEvent.change(business, {
      target: { value: 'Updated Studio' }
    });

    expect(publishButton().disabled).toBe(true);
    expect(requests).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', {
      name: /save draft/i
    }));

    await waitFor(() => {
      expect(publishButton().disabled).toBe(false);
    });

    fireEvent.click(publishButton());

    await waitFor(() => {
      expect(requests).toHaveLength(1);
    });

    expect(requests[0].expectedVersion).toBe(5);
  });

  it('blocks duplicate publication and website switching', async () => {
    const pending = deferred<Response>();

    const requests = setup({
      respond: () => pending.promise
    });

    const business = await loaded();

    const selector = screen.getByLabelText(
      'Your websites'
    ) as HTMLSelectElement;

    address('example-studio');

    const button = publishButton();
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => {
      expect(requests).toHaveLength(1);
      expect(selector.disabled).toBe(true);
      expect(business.matches(':disabled')).toBe(true);
    });

    fireEvent.change(selector, {
      target: { value: B }
    });

    expect(selector.value).toBe(A);

    await act(async () => {
      pending.resolve(success(requests[0]));
      await pending.promise;
    });

    await waitFor(() => {
      expect(selector.disabled).toBe(false);
    });

    expect(requests).toHaveLength(1);
  });

  it('updates publication status after success', async () => {
    const requests = setup();
    await loaded();

    address('example-studio');
    fireEvent.click(publishButton());

    await screen.findByText('Website published successfully.');

    expect(requests[0]).toEqual({
      websiteId: A,
      expectedVersion: 4,
      slug: 'example-studio'
    });

    expect(screen.getByText(
      'Your website is published.'
    )).toBeTruthy();

    const link = screen.getByRole('link', {
      name: /view published test website/i
    });

    expect(link.getAttribute('href'))
      .toBe('/sites/example-studio');

    expect((screen.getByRole('button', {
      name: /publish changes/i
    }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('allows retry after an address collision', async () => {
    let attempts = 0;

    const requests = setup({
      respond: payload => {
        attempts += 1;

        return attempts === 1
          ? json({
              error: 'That website address is unavailable'
            }, 409)
          : success(payload);
      }
    });

    await loaded();
    address('example-studio');
    fireEvent.click(publishButton());

    await screen.findByText(
      'That website address is unavailable'
    );

    address('another-studio');
    fireEvent.click(publishButton());

    await screen.findByText(
      'Website published successfully.'
    );

    expect(requests).toHaveLength(2);
    expect(requests[1].slug).toBe('another-studio');
  });

  it('blocks publication after a draft version conflict', async () => {
    const requests = setup({
      respond: () => json({
        error: 'Draft has changed. Refresh before publishing.'
      }, 409)
    });

    await loaded();
    address('example-studio');
    fireEvent.click(publishButton());

    await screen.findByText(/Publication conflict:/i);

    expect(publishButton().disabled).toBe(true);
    expect(requests).toHaveLength(1);
  });

  it('republishes saved changes using the existing address', async () => {
    const requests = setup({ published: true });
    const business = await loaded();

    const button = screen.getByRole('button', {
      name: /publish changes/i
    }) as HTMLButtonElement;

    expect(button.disabled).toBe(true);

    fireEvent.change(business, {
      target: { value: 'Updated Studio' }
    });

    expect(button.disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', {
      name: /save draft/i
    }));

    await waitFor(() => {
      expect(button.disabled).toBe(false);
    });

    fireEvent.click(button);

    await screen.findByText(
      'Website published successfully.'
    );

    expect(requests[0]).toEqual({
      websiteId: A,
      expectedVersion: 5,
      slug: 'example-studio'
    });
  });

  it('recognizes previously published sites with newer saved drafts', async () => {
    setup({
      published: true,
      publishedVersion: '3'
    });

    await loaded();

    expect(screen.getByText(
      'Saved changes are not visible to visitors until you publish.'
    )).toBeTruthy();

    expect((screen.getByRole('button', {
      name: /publish changes/i
    }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('does not claim success when publication cannot be confirmed', async () => {
    setup({
      respond: () => json({
        published: true,
        websiteId: B,
        sourceDraftVersion: 4,
        slug: 'example-studio'
      })
    });

    await loaded();
    address('example-studio');
    fireEvent.click(publishButton());

    await screen.findByText(
      /Publication could not be confirmed/i
    );

    expect(screen.queryByText(
      'Website published successfully.'
    )).toBeNull();
  });
});
