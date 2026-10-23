// Storefront pages are rendered as complete HTML documents by app/[[...slug]]/route.ts (legacy Astra/WooCommerce
// markup). This root layout only wraps React pages added later (e.g. /admin).
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW">
      <body>{children}</body>
    </html>
  );
}
