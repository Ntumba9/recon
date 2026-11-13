/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // e2e/flows.spec.ts asserts these headers on the findings and runs pages,
  // that hydration actually completes under this exact policy (a button
  // click only works once React has attached its handlers), and that no
  // CSP violation is reported in the console. "unsafe-inline" on
  // script-src is required for Next's own hydration bootstrap script, not
  // for anything this app adds itself - there is no other inline script or
  // event-handler attribute anywhere in the app.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data:",
              "connect-src 'self'",
              "frame-ancestors 'none'",
              "base-uri 'none'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
