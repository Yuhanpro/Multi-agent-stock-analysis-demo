/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Static HTML export for nginx to serve directly.
  // Trade-offs: no server components / SSR / API routes — we don't use
  // any of those (the FastAPI backend handles all dynamic work).
  output: "export",
  // SSE responses must not be buffered or transformed by Next's response
  // pipeline — see app/api/* (we don't proxy them through Next; the
  // browser hits the FastAPI backend directly via NEXT_PUBLIC_API_BASE).
  trailingSlash: true,
  images: { unoptimized: true },
};

module.exports = nextConfig;
