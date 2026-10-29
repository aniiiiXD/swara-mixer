import type { Metadata } from "next";
import { DM_Serif_Display, DM_Sans, JetBrains_Mono, Tiro_Devanagari_Sanskrit } from "next/font/google";
import "./globals.css";
import AppNav from "@/components/AppNav";
import PracticeProvider from "@/components/practice/PracticeProvider";

const display = DM_Serif_Display({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
});

const body = DM_Sans({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
});

const mono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["300", "400", "500"],
});

const deva = Tiro_Devanagari_Sanskrit({
  variable: "--font-deva",
  subsets: ["devanagari", "latin"],
  weight: ["400"],
});

export const metadata: Metadata = {
  title: "Tonic — a studio to learn singing",
  description: "Tonic is a studio to learn singing: separate any song into stems, practice with live pitch tracking, and get your takes scored note by note.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${body.variable} ${mono.variable} ${deva.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <PracticeProvider>
          <AppNav />
          {children}
        </PracticeProvider>
      </body>
    </html>
  );
}
