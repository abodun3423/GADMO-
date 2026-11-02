import type { NextRequest } from 'next/server';

/**
 * Same-origin bridge to the GADMO API: the browser calls /v1/* on the web app and this
 * forwards the request to API_URL (read at runtime, so one build works in every
 * environment). Login cookies stay first-party, and the CSRF header passes through.
 */
const FORWARD_REQUEST_HEADERS = [
  'content-type',
  'cookie',
  'user-agent',
  'x-gadmo-client',
  'accept',
  'accept-language',
];
const FORWARD_RESPONSE_HEADERS = ['content-type', 'retry-after', 'cache-control'];
const MAX_BODY_BYTES = 100 * 1024;

async function forward(request: NextRequest, path: string[]): Promise<Response> {
  const apiUrl = process.env.API_URL ?? 'http://localhost:4000';
  const target = new URL(`/v1/${path.map(encodeURIComponent).join('/')}`, apiUrl);
  target.search = request.nextUrl.search;

  const headers = new Headers();
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  // Pass on the client address set by the load balancer, for per-IP rate limits.
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) headers.set('x-forwarded-for', forwardedFor);

  let body: ArrayBuffer | undefined;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    body = await request.arrayBuffer();
    if (body.byteLength > MAX_BODY_BYTES) {
      return Response.json({ message: 'Request too large' }, { status: 413 });
    }
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body,
      redirect: 'manual',
      cache: 'no-store',
    });
  } catch {
    return Response.json(
      { message: 'GADMO is having trouble right now. Please try again shortly.' },
      { status: 502 },
    );
  }

  const responseHeaders = new Headers();
  for (const name of FORWARD_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  for (const cookie of upstream.headers.getSetCookie())
    responseHeaders.append('set-cookie', cookie);
  responseHeaders.set('cache-control', 'no-store');

  return new Response(upstream.status === 204 ? null : upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

type Context = { params: Promise<{ path: string[] }> };

const handler = async (request: NextRequest, { params }: Context) =>
  forward(request, (await params).path);

export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE };
