// @vitest-environment jsdom

import React from 'react';
import {
  describe, it, expect, vi, afterEach
} from 'vitest';
import {
  render, screen, fireEvent, waitFor, act, cleanup
} from '@testing-library/react';

import CustomerArea from '../src/app/(platform)/app/page';
import { editions } from '../src/lib/editions';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const edition = editions[0].slug;

function draft(business: string) {
  return {
    edition,
    business,
    headline: 'Test headline',
    description: 'Test introduction',
    email: '',
    phone: '',
    booking: '',
    palette: 0
  };
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => {
    resolve = r;
  });
  return { promise, resolve };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Editor asynchronous website isolation', () => {
  it.each([200, 500])(
    'ignores obsolete Website A response with HTTP %s',
    async status => {
      const pendingA = deferred<Response>();

      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), 'http://localhost');

        if (url.pathname === '/api/websites') {
          return json({
            websites: [
              { id: A, name: 'Website A', edition,
                publication_status: 'draft' },
              { id: B, name: 'Website B', edition,
                publication_status: 'draft' }
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
          const id = url.searchParams.get('websiteId');

          if (id === A) return pendingA.promise;

          if (id === B) {
            return json({
              websiteId: B,
              draft: draft('Business B'),
              version: 7
            });
          }
        }

        throw new Error('Unexpected request: ' + url.href);
      });

      vi.stubGlobal('fetch', fetchMock);

      render(<CustomerArea />);

      const selector = await screen.findByLabelText('Your websites');

      await waitFor(() => {
        expect(fetchMock.mock.calls.some(
          ([url]) => String(url).includes('/api/draft?websiteId=' + A)
        )).toBe(true);
      });

      fireEvent.change(selector, {
        target: { value: B }
      });

      const business = await screen.findByLabelText(
        'Business name'
      ) as HTMLInputElement;

      await waitFor(() => {
        expect(business.value).toBe('Business B');
        expect(business.matches(':disabled')).toBe(false);
      });

      await act(async () => {
        pendingA.resolve(json({
          websiteId: A,
          draft: draft('Obsolete Business A'),
          version: 2
        }, status));

        await pendingA.promise;
      });

      expect(business.value).toBe('Business B');
      expect(business.matches(':disabled')).toBe(false);
      expect((selector as HTMLSelectElement).value).toBe(B);

      console.log(
        'PASS: Obsolete Website A response ignored (' + status + ')'
      );
    }
  );
});


// STEP 55Q.20BB: Rapid website switching
describe('Editor request generation isolation', () => {
  it('rejects obsolete responses after A to B to A switching', async () => {
    const firstA = deferred<Response>();
    const secondA = deferred<Response>();
    let requestsA = 0;

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost');

      if (url.pathname === '/api/websites') {
        return json({
          websites: [
            { id: A, name: 'Website A', edition,
              publication_status: 'draft' },
            { id: B, name: 'Website B', edition,
              publication_status: 'draft' }
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
        const id = url.searchParams.get('websiteId');

        if (id === A) {
          requestsA += 1;
          return requestsA === 1
            ? firstA.promise
            : secondA.promise;
        }

        if (id === B) {
          return json({
            websiteId: B,
            draft: draft('Business B'),
            version: 4
          });
        }
      }

      throw new Error('Unexpected request: ' + url.href);
    });

    vi.stubGlobal('fetch', fetchMock);

    render(<CustomerArea />);

    const selector = await screen.findByLabelText('Your websites');

    await waitFor(() => {
      expect(requestsA).toBe(1);
    });

    fireEvent.change(selector, {
      target: { value: B }
    });

    const business = await screen.findByLabelText(
      'Business name'
    ) as HTMLInputElement;

    await waitFor(() => {
      expect(business.value).toBe('Business B');
    });

    fireEvent.change(selector, {
      target: { value: A }
    });

    await waitFor(() => {
      expect(requestsA).toBe(2);
    });

    await act(async () => {
      secondA.resolve(json({
        websiteId: A,
        draft: draft('Current Business A'),
        version: 9
      }));
      await secondA.promise;
    });

    await waitFor(() => {
      expect(business.value).toBe('Current Business A');
    });

    await act(async () => {
      firstA.resolve(json({
        websiteId: A,
        draft: draft('Obsolete Business A'),
        version: 1
      }));
      await firstA.promise;
    });

    expect(business.value).toBe('Current Business A');
    expect(business.matches(':disabled')).toBe(false);
    expect((selector as HTMLSelectElement).value).toBe(A);

    console.log('PASS: A to B to A request isolation');
  });
});


// STEP 55Q.20BC: Mutation isolation
describe('Editor mutation isolation', () => {
  it('prevents duplicate saves and website switching during a save', async () => {
    const pendingSave = deferred<Response>();
    let saveRequests = 0;
    const payloads: Record<string, unknown>[] = [];

    const fetchMock = vi.fn(async (
      input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      const url = new URL(String(input), 'http://localhost');

      if (url.pathname === '/api/websites') {
        return json({
          websites: [
            { id: A, name: 'Website A', edition,
              publication_status: 'draft' },
            { id: B, name: 'Website B', edition,
              publication_status: 'draft' }
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
          saveRequests += 1;
          payloads.push(JSON.parse(String(init.body)));
          return pendingSave.promise;
        }

        const id = url.searchParams.get('websiteId');

        return json({
          websiteId: id,
          draft: draft(id === A ? 'Business A' : 'Business B'),
          version: 4
        });
      }

      throw new Error('Unexpected request: ' + url.href);
    });

    vi.stubGlobal('fetch', fetchMock);

    render(<CustomerArea />);

    const selector = await screen.findByLabelText(
      'Your websites'
    ) as HTMLSelectElement;

    const business = await screen.findByLabelText(
      'Business name'
    ) as HTMLInputElement;

    await waitFor(() => {
      expect(business.value).toBe('Business A');
      expect(business.matches(':disabled')).toBe(false);
    });

    fireEvent.change(business, {
      target: { value: 'Updated Business A' }
    });

    const saveButton = screen.getByRole('button', {
      name: /save draft/i
    }) as HTMLButtonElement;

    fireEvent.click(saveButton);
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(saveRequests).toBe(1);
      expect(selector.disabled).toBe(true);
      expect(saveButton.disabled).toBe(true);
      expect(business.matches(':disabled')).toBe(true);
    });

    fireEvent.change(selector, {
      target: { value: B }
    });

    expect(saveRequests).toBe(1);
    expect(selector.value).toBe(A);
    expect(payloads[0].websiteId).toBe(A);
    expect(payloads[0].expectedVersion).toBe(4);

    await act(async () => {
      pendingSave.resolve(json({
        saved: true,
        websiteId: A,
        version: 5
      }));
      await pendingSave.promise;
    });

    await waitFor(() => {
      expect(selector.disabled).toBe(false);
    });

    expect(business.value).toBe('Updated Business A');
    expect(saveRequests).toBe(1);

    console.log('PASS: Duplicate save prevented');
    console.log('PASS: Website switching blocked during save');
    console.log('PASS: Save payload targets correct website');
    console.log('PASS: Website switching reenabled after save');
  });
});


// STEP 55Q.20BD: Save conflict preservation
describe('Editor optimistic concurrency', () => {
  it('preserves unsaved edits after an HTTP 409 conflict', async () => {
    let saveRequests = 0;

    const fetchMock = vi.fn(async (
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
              edition,
              publication_status: 'draft'
            }
          ]
        });
      }

      if (url.pathname === '/api/draft/revisions') {
        return json({
          websiteId: A,
          revisions: []
        });
      }

      if (url.pathname === '/api/draft') {
        if (init?.method === 'PUT') {
          saveRequests += 1;

          const payload = JSON.parse(String(init.body));

          expect(payload.websiteId).toBe(A);
          expect(payload.expectedVersion).toBe(4);
          expect(payload.draft.business).toBe('Unsaved customer edits');

          return json({
            error: 'Version conflict'
          }, 409);
        }

        return json({
          websiteId: A,
          draft: draft('Original Business'),
          version: 4
        });
      }

      throw new Error('Unexpected request: ' + url.href);
    });

    vi.stubGlobal('fetch', fetchMock);

    render(<CustomerArea />);

    const business = await screen.findByLabelText(
      'Business name'
    ) as HTMLInputElement;

    await waitFor(() => {
      expect(business.value).toBe('Original Business');
      expect(business.matches(':disabled')).toBe(false);
    });

    fireEvent.change(business, {
      target: { value: 'Unsaved customer edits' }
    });

    const saveButton = screen.getByRole('button', {
      name: /save draft/i
    }) as HTMLButtonElement;

    fireEvent.click(saveButton);

    await screen.findByText(/Save conflict:/i);

    expect(business.value).toBe('Unsaved customer edits');
    expect(saveButton.disabled).toBe(true);
    expect(saveRequests).toBe(1);

    fireEvent.click(saveButton);

    expect(saveRequests).toBe(1);
    expect(business.value).toBe('Unsaved customer edits');

    console.log('PASS: Version conflict displayed');
    console.log('PASS: Unsaved customer edits preserved');
    console.log('PASS: Conflicting save retries blocked');
  });
});


// STEP 55Q.20BE: Revision history ordering
describe('Editor revision history isolation', () => {
  it('ignores obsolete history after switching websites', async () => {
    const pendingHistory = deferred<Response>();
    let historyRequestsA = 0;
    let historyRequestsB = 0;

    const revisionA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const revisionB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

    const fetchMock = vi.fn(async (
      input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      const url = new URL(String(input), 'http://localhost');
      const id = url.searchParams.get('websiteId');

      if (url.pathname === '/api/websites') {
        return json({
          websites: [
            { id: A, name: 'Website A', edition,
              publication_status: 'draft' },
            { id: B, name: 'Website B', edition,
              publication_status: 'draft' }
          ]
        });
      }

      if (url.pathname === '/api/draft/revisions') {
        if (id === A) {
          historyRequestsA += 1;
          return pendingHistory.promise;
        }

        if (id === B) {
          historyRequestsB += 1;
          return json({
            websiteId: B,
            revisions: [{
              id: revisionB,
              created_at: '2026-11-24T12:00:00Z'
            }]
          });
        }
      }

      if (url.pathname === '/api/draft') {
        if (init?.method === 'PUT') {
          const payload = JSON.parse(String(init.body));

          return json({
            saved: true,
            websiteId: payload.websiteId,
            version: payload.expectedVersion + 1
          });
        }

        return json({
          websiteId: id,
          draft: draft(id === A ? 'Business A' : 'Business B'),
          version: 4
        });
      }

      throw new Error('Unexpected request: ' + url.href);
    });

    vi.stubGlobal('fetch', fetchMock);

    const { container } = render(<CustomerArea />);

    const selector = await screen.findByLabelText(
      'Your websites'
    ) as HTMLSelectElement;

    const business = await screen.findByLabelText(
      'Business name'
    ) as HTMLInputElement;

    await waitFor(() => {
      expect(business.value).toBe('Business A');
      expect(business.matches(':disabled')).toBe(false);
    });

    fireEvent.change(business, {
      target: { value: 'Updated Business A' }
    });

    fireEvent.click(screen.getByRole('button', {
      name: /save draft/i
    }));

    await waitFor(() => {
      expect(historyRequestsA).toBeGreaterThan(0);
      expect(selector.disabled).toBe(false);
    });

    fireEvent.change(selector, {
      target: { value: B }
    });

    await waitFor(() => {
      expect(business.value).toBe('Business B');
      expect(business.matches(':disabled')).toBe(false);
    });

    fireEvent.change(business, {
      target: { value: 'Updated Business B' }
    });

    fireEvent.click(screen.getByRole('button', {
      name: /save draft/i
    }));

    await waitFor(() => {
      expect(historyRequestsB).toBeGreaterThan(0);
      expect(container.querySelector(
        'option[value="' + revisionB + '"]'
      )).not.toBeNull();
    });

    await act(async () => {
      pendingHistory.resolve(json({
        websiteId: A,
        revisions: [{
          id: revisionA,
          created_at: '2026-11-23T12:00:00Z'
        }]
      }));

      await pendingHistory.promise;
    });

    expect(container.querySelector(
      'option[value="' + revisionB + '"]'
    )).not.toBeNull();

    expect(container.querySelector(
      'option[value="' + revisionA + '"]'
    )).toBeNull();

    expect(business.value).toBe('Updated Business B');

    console.log('PASS: Obsolete revision history ignored');
    console.log('PASS: Current website history preserved');
  });
});


// STEP 55Q.20BF: Revision restoration behavior
describe('Editor revision restoration', () => {
  it('isolates restoration and advances the draft version', async () => {
    const pendingRestore = deferred<Response>();
    const revisionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

    const savePayloads: any[] = [];
    const restorePayloads: any[] = [];

    vi.stubGlobal('confirm', vi.fn(() => true));

    const fetchMock = vi.fn(async (
      input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      const url = new URL(String(input), 'http://localhost');

      if (url.pathname === '/api/websites') {
        return json({
          websites: [
            { id: A, name: 'Website A', edition,
              publication_status: 'draft' },
            { id: B, name: 'Website B', edition,
              publication_status: 'draft' }
          ]
        });
      }

      if (url.pathname === '/api/draft/revisions') {
        return json({
          websiteId: A,
          revisions: [{
            id: revisionId,
            created_at: '2026-11-24T12:00:00Z'
          }]
        });
      }

      if (url.pathname === '/api/draft/restore') {
        restorePayloads.push(JSON.parse(String(init?.body)));
        return pendingRestore.promise;
      }

      if (url.pathname === '/api/draft') {
        if (init?.method === 'PUT') {
          const payload = JSON.parse(String(init.body));
          savePayloads.push(payload);

          return json({
            saved: true,
            websiteId: A,
            version: payload.expectedVersion + 1
          });
        }

        return json({
          websiteId: A,
          draft: draft('Current Business'),
          version: 4
        });
      }

      throw new Error('Unexpected request: ' + url.href);
    });

    vi.stubGlobal('fetch', fetchMock);

    const { container } = render(<CustomerArea />);

    const business = await screen.findByLabelText(
      'Business name'
    ) as HTMLInputElement;

    const selector = await screen.findByLabelText(
      'Your websites'
    ) as HTMLSelectElement;

    await waitFor(() => {
      expect(business.value).toBe('Current Business');
      expect(business.matches(':disabled')).toBe(false);
    });

    fireEvent.change(business, {
      target: { value: 'Updated Business' }
    });

    fireEvent.click(screen.getByRole('button', {
      name: /save draft/i
    }));

    await waitFor(() => {
      expect(savePayloads).toHaveLength(1);
      expect(container.querySelector(
        'option[value="' + revisionId + '"]'
      )).not.toBeNull();
    });

    const revisionOption = container.querySelector(
      'option[value="' + revisionId + '"]'
    )!;

    const revisionSelector = revisionOption.closest('select')!;

    fireEvent.change(revisionSelector, {
      target: { value: revisionId }
    });

    const restoreButton = screen.getByRole('button', {
      name: /restore/i
    }) as HTMLButtonElement;

    fireEvent.click(restoreButton);

    await waitFor(() => {
      expect(restorePayloads).toHaveLength(1);
      expect(selector.disabled).toBe(true);
      expect(business.matches(':disabled')).toBe(true);
    });

    expect(restorePayloads[0]).toEqual({
      websiteId: A,
      revisionId,
      expectedVersion: 5
    });

    const saveButton = screen.getByRole('button', {
      name: /save draft/i
    }) as HTMLButtonElement;

    expect(saveButton.disabled).toBe(true);

    fireEvent.click(saveButton);
    fireEvent.change(selector, {
      target: { value: B }
    });

    expect(savePayloads).toHaveLength(1);
    expect(selector.value).toBe(A);

    await act(async () => {
      pendingRestore.resolve(json({
        restored: true,
        websiteId: A,
        draft: draft('Restored Business'),
        version: 6
      }));

      await pendingRestore.promise;
    });

    await waitFor(() => {
      expect(business.value).toBe('Restored Business');
      expect(selector.disabled).toBe(false);
      expect(saveButton.disabled).toBe(false);
    });

    fireEvent.change(business, {
      target: { value: 'Edited Restored Business' }
    });

    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(savePayloads).toHaveLength(2);
    });

    expect(savePayloads[1].expectedVersion).toBe(6);
    expect(savePayloads[1].websiteId).toBe(A);
    expect(savePayloads[1].draft.business)
      .toBe('Edited Restored Business');

    console.log('PASS: Restoration targets correct website');
    console.log('PASS: Concurrent mutations prevented');
    console.log('PASS: Restored content displayed');
    console.log('PASS: Subsequent save uses restored version');
  });
});


// STEP 55Q.20BG: Same-website history sequencing
describe('Same-website revision sequencing', () => {
  it('prevents older history from replacing newer history', async () => {
    const olderHistory = deferred<Response>();
    const newerHistory = deferred<Response>();

    const oldId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const newId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

    let historyRequests = 0;
    const savePayloads: any[] = [];

    const fetchMock = vi.fn(async (
      input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      const url = new URL(String(input), 'http://localhost');

      if (url.pathname === '/api/websites') {
        return json({
          websites: [{
            id: A,
            name: 'Website A',
            edition,
            publication_status: 'draft'
          }]
        });
      }

      if (url.pathname === '/api/draft/revisions') {
        historyRequests += 1;

        return historyRequests === 1
          ? olderHistory.promise
          : newerHistory.promise;
      }

      if (url.pathname === '/api/draft') {
        if (init?.method === 'PUT') {
          const payload = JSON.parse(String(init.body));
          savePayloads.push(payload);

          return json({
            saved: true,
            websiteId: A,
            version: payload.expectedVersion + 1
          });
        }

        return json({
          websiteId: A,
          draft: draft('Original Business'),
          version: 4
        });
      }

      throw new Error('Unexpected request: ' + url.href);
    });

    vi.stubGlobal('fetch', fetchMock);

    const { container } = render(<CustomerArea />);

    const business = await screen.findByLabelText(
      'Business name'
    ) as HTMLInputElement;

    await waitFor(() => {
      expect(business.value).toBe('Original Business');
      expect(business.matches(':disabled')).toBe(false);
    });

    const saveButton = screen.getByRole('button', {
      name: /save draft/i
    }) as HTMLButtonElement;

    fireEvent.change(business, {
      target: { value: 'First Edit' }
    });

    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(historyRequests).toBe(1);
      expect(saveButton.disabled).toBe(false);
    });

    fireEvent.change(business, {
      target: { value: 'Second Edit' }
    });

    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(historyRequests).toBe(2);
      expect(saveButton.disabled).toBe(false);
    });

    expect(savePayloads).toHaveLength(2);
    expect(savePayloads[0].expectedVersion).toBe(4);
    expect(savePayloads[1].expectedVersion).toBe(5);

    await act(async () => {
      newerHistory.resolve(json({
        websiteId: A,
        revisions: [{
          id: newId,
          created_at: '2026-11-24T13:00:00Z'
        }]
      }));

      await newerHistory.promise;
    });

    await waitFor(() => {
      expect(container.querySelector(
        'option[value="' + newId + '"]'
      )).not.toBeNull();
    });

    await act(async () => {
      olderHistory.resolve(json({
        websiteId: A,
        revisions: [{
          id: oldId,
          created_at: '2026-11-24T12:00:00Z'
        }]
      }));

      await olderHistory.promise;
    });

    expect(container.querySelector(
      'option[value="' + newId + '"]'
    )).not.toBeNull();

    expect(container.querySelector(
      'option[value="' + oldId + '"]'
    )).toBeNull();

    expect(business.value).toBe('Second Edit');

    console.log('PASS: Older history response ignored');
    console.log('PASS: Latest revision history preserved');
    console.log('PASS: Sequential save versions verified');
  });
});


// STEP 55Q.20BK: Unsaved-change protection
describe('Editor unsaved-change protection', () => {
  it.each([
    'cancel-switch',
    'confirm-switch',
    'failed-save',
    'successful-save'
  ])('protects customer edits: %s', async scenario => {
    const confirmMock = vi.fn(
      () => scenario !== 'cancel-switch'
    );

    vi.stubGlobal('confirm', confirmMock);

    let saveRequests = 0;
    let requestsB = 0;

    const fetchMock = vi.fn(async (
      input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      const url = new URL(String(input), 'http://localhost');
      const id = url.searchParams.get('websiteId');

      if (url.pathname === '/api/websites') {
        return json({
          websites: [
            { id: A, name: 'Website A', edition,
              publication_status: 'draft' },
            { id: B, name: 'Website B', edition,
              publication_status: 'draft' }
          ]
        });
      }

      if (url.pathname === '/api/draft/revisions') {
        return json({
          websiteId: id,
          revisions: []
        });
      }

      if (url.pathname === '/api/draft') {
        if (init?.method === 'PUT') {
          saveRequests += 1;

          if (scenario === 'failed-save') {
            return json({ error: 'Save failed' }, 500);
          }

          return json({
            saved: true,
            websiteId: A,
            version: 5
          });
        }

        if (id === B) requestsB += 1;

        return json({
          websiteId: id,
          draft: draft(id === A ? 'Business A' : 'Business B'),
          version: 4
        });
      }

      throw new Error('Unexpected request: ' + url.href);
    });

    vi.stubGlobal('fetch', fetchMock);

    render(<CustomerArea />);

    const selector = await screen.findByLabelText(
      'Your websites'
    ) as HTMLSelectElement;

    const business = await screen.findByLabelText(
      'Business name'
    ) as HTMLInputElement;

    await waitFor(() => {
      expect(business.value).toBe('Business A');
      expect(business.matches(':disabled')).toBe(false);
    });

    function unloadPrevented() {
      const event = new Event('beforeunload', {
        cancelable: true
      });

      window.dispatchEvent(event);
      return event.defaultPrevented;
    }

    expect(unloadPrevented()).toBe(false);

    fireEvent.change(business, {
      target: { value: 'Unsaved Business A' }
    });

    expect(unloadPrevented()).toBe(true);

    if (
      scenario === 'failed-save' ||
      scenario === 'successful-save'
    ) {
      const saveButton = screen.getByRole('button', {
        name: /save draft/i
      }) as HTMLButtonElement;

      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(saveRequests).toBe(1);
        expect(saveButton.disabled).toBe(false);
      });

      if (scenario === 'failed-save') {
        expect(unloadPrevented()).toBe(true);
        expect(business.value).toBe('Unsaved Business A');
        await screen.findByText(/Unable to save/i);
      } else {
        expect(unloadPrevented()).toBe(false);
        await waitFor(() => {
          expect(screen.getByRole('status').textContent?.trim())
            .toBe('Saved to your account');
        });
      }
    }

    fireEvent.change(selector, {
      target: { value: B }
    });

    if (scenario === 'cancel-switch') {
      expect(confirmMock).toHaveBeenCalledTimes(1);
      expect(selector.value).toBe(A);
      expect(business.value).toBe('Unsaved Business A');
      expect(requestsB).toBe(0);
      expect(unloadPrevented()).toBe(true);
    } else {
      await waitFor(() => {
        expect(business.value).toBe('Business B');
        expect(selector.value).toBe(B);
      });

      expect(unloadPrevented()).toBe(false);

      expect(confirmMock).toHaveBeenCalledTimes(
        scenario === 'successful-save' ? 0 : 1
      );
    }

    console.log('PASS: Unsaved-change protection: ' + scenario);
  });
});
