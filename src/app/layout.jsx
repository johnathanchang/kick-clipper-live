import "./globals.css";

export const metadata = {
  title: "Kick Clipper",
  description: "Watermark-aware captions for Kick clips.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
