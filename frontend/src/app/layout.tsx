import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stem Studio",
  description: "Online mixing studio powered by Meta Demucs",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,300;1,9..40,400&family=JetBrains+Mono:wght@300;400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body suppressHydrationWarning className="min-h-full flex flex-col">
        <ClerkProvider
          appearance={{
            baseTheme: dark,
            variables: {
              colorPrimary: "#c8956c",
              colorBackground: "#1e1b18",
              colorInputBackground: "#252220",
              colorInputText: "#f3efe8",
              colorText: "#f3efe8",
              colorTextOnPrimaryBackground: "#1a1614",
              colorTextSecondary: "#b5a48e",
              colorNeutral: "#e8e0d4",
              borderRadius: "0.5rem",
            },
            elements: {
              modalContent: { backgroundColor: "#1e1b18" },
              card: { backgroundColor: "#1e1b18" },
              headerTitle: { color: "#f3efe8" },
              headerSubtitle: { color: "#b5a48e" },
              socialButtonsBlockButton: { color: "#f3efe8", borderColor: "#3a3530" },
              socialButtonsBlockButtonText: { color: "#f3efe8" },
              dividerText: { color: "#b5a48e" },
              dividerLine: { borderColor: "#3a3530" },
              formFieldLabel: { color: "#d4c9b8" },
              formFieldInput: { color: "#f3efe8", backgroundColor: "#252220", borderColor: "#3a3530" },
              footerActionText: { color: "#b5a48e" },
              footerActionLink: { color: "#c8956c" },
              identityPreviewText: { color: "#f3efe8" },
              identityPreviewEditButton: { color: "#c8956c" },
              formButtonPrimary: { backgroundColor: "#c8956c", color: "#1a1614" },
              otpCodeFieldInput: { color: "#f3efe8", borderColor: "#3a3530" },
              alternativeMethodsBlockButton: { color: "#f3efe8", borderColor: "#3a3530" },
              modalBackdrop: { backgroundColor: "rgba(0, 0, 0, 0.7)" },
            },
          }}
        >
          <div className="noise-overlay" />
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}
