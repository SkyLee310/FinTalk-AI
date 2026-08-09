import type { NextConfig } from 'next';

/**
 * The API is proxied through this origin rather than called directly.
 *
 * The session cookie is httpOnly and set by the backend. Called directly, that
 * cookie is third-party — the page is on vercel.app and the cookie comes from
 * railway.app — so Safari's tracking prevention discards it outright and Chrome
 * discards it in Incognito. The login POST returns 200, the cookie is dropped,
 * and the app bounces back to the sign-in page with nothing to show the user.
 * That is not a misconfiguration; it is what cross-site cookies now do.
 *
 * Proxying makes the cookie first-party, so it survives, and nothing about the
 * httpOnly model changes. The alternative fixes were worse: a token in
 * localStorage gives up httpOnly and hands an XSS the session, and a shared
 * parent domain means buying one.
 */
const backendOrigin = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, '');

const nextConfig: NextConfig = {
  reactStrictMode: true,

  rewrites: () => {
    if (!backendOrigin) {
      // Fail loudly at build time. A silent empty rewrite list would deploy a
      // frontend whose every request 404s on its own origin.
      throw new Error(
        'NEXT_PUBLIC_API_BASE_URL is required to build: it is the rewrite '
        + 'destination for /api/:path*.',
      );
    }

    return Promise.resolve([
      { source: '/api/:path*', destination: `${backendOrigin}/:path*` },
    ]);
  },
};

export default nextConfig;
