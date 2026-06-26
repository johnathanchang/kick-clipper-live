import { Work_Sans } from "next/font/google";

import "./globals.css";

const workSans = Work_Sans({
  subsets: ["latin"],
  display: "swap",
});

export const metadata = {
  title: "Kick Clipper",
  description: "Kick Clipper",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={workSans.className}>{children}</body>
    </html>
  );
}
