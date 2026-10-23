import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // WordPress-style URLs: every page path ends in "/". The redirect for paths without the slash is done
  // in the catch-all route (301, like WordPress) so /api/* keeps answering on both forms.
  trailingSlash: true,
  skipTrailingSlashRedirect: true,
  poweredByHeader: false,
  images: { unoptimized: true },
  // admin content saves (large Elementor HTML) go through server actions
  experimental: { serverActions: { bodySizeLimit: '4mb' } },
  serverExternalPackages: ['sharp'],
  async headers() {
    return [
      { source: "/legacy/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }] },
    ];
  },
};

export default nextConfig;
