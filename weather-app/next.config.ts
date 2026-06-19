import type { NextConfig } from "next";

// Hardened security headers applied to every response. These are safe for the
// MapLibre map (no CSP that would block tile/style hosts is added here — add a
// tested CSP separately). They defend against clickjacking, MIME-sniffing,
// referrer leakage, and downgrade attacks.
const securityHeaders = [
  // Force HTTPS for 2 years incl. subdomains (effective once ALB/ACM is added)
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  // Block this app from being framed (clickjacking defense)
  { key: "X-Frame-Options", value: "DENY" },
  // Stop browsers from MIME-sniffing responses
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Don't leak full URLs (which never contain secrets client-side) to other origins
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Drop access to powerful browser features the app does not use
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(self), interest-cohort=()",
  },
];

const nextConfig: NextConfig = {
  // Required for multi-stage Docker builds — produces self-contained server.js
  output: "standalone",
  // Don't expose the framework version in the Server/X-Powered-By header
  poweredByHeader: false,
  // SECURITY: `logging.fetches.fullUrl: true` was REMOVED. The server-side
  // geocode/tile fetches put `?appid=<OPENWEATHER_API_KEY>` in the URL, so
  // logging the full URL leaked the decrypted API key into stdout → CloudWatch
  // Logs (/weather-app/<env>/app), readable by anyone with CWL access.
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
