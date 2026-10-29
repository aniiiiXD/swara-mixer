import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Tonic Studio — sing, record, understand",
  description: "A personal studio for singing and studying pitch.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
