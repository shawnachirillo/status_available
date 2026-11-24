import {
  clerkMiddleware,
  createRouteMatcher
} from '@clerk/nextjs/server';

import {
  NextRequest,
  NextResponse,
  type NextFetchEvent
} from 'next/server';

import {
  classifyHostname
} from './lib/websites/hostname';

const isProtectedRoute = createRouteMatcher([
  '/app(.*)'
]);

const platformMiddleware = clerkMiddleware(
  async (auth, req) => {
    if (isProtectedRoute(req)) {
      await auth.protect();
    }
  }
);

function unavailable() {
  return new NextResponse('Website unavailable', {
    status: 404,
    headers: {
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow'
    }
  });
}

export function proxy(
  req: NextRequest,
  event: NextFetchEvent
) {
  const enabled =
    process.env.STATUS_SUBDOMAIN_ROUTING === 'true';

  if (!enabled) {
    return platformMiddleware(req, event);
  }

  const baseDomain =
    process.env.STATUS_BASE_DOMAIN ||
    'status-available.com';

  const rawHost = req.headers.get('host') || '';

  if (
    !/^[a-zA-Z0-9.-]+(?::[0-9]{1,5})?$/.test(rawHost)
  ) {
    return unavailable();
  }

  const hostname = rawHost.replace(/:\d+$/, '');

  const destination = classifyHostname(
    hostname,
    baseDomain
  );

  if (destination.kind === 'invalid') {
    return unavailable();
  }

  if (destination.kind === 'customer') {
    if (
      !['GET', 'HEAD'].includes(req.method) ||
      req.nextUrl.pathname !== '/'
    ) {
      return unavailable();
    }

    const url = req.nextUrl.clone();

    url.pathname = `/sites/${destination.slug}`;
    url.search = '';

    const response = NextResponse.rewrite(url);

    response.headers.set(
      'Cache-Control',
      'private, no-store, max-age=0'
    );

    response.headers.set(
      'X-Robots-Tag',
      'noindex, nofollow'
    );

    return response;
  }

  return platformMiddleware(req, event);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)'
  ]
};
