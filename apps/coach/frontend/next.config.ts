import type { NextConfig } from "next";

// Tonic ships as a desktop app: Tauri serves this build as static files from its
// own asset protocol, so there is no Node server at runtime. Everything the UI
// needs comes from the local Tonic API over fetch (see lib/runtimeConfig.ts),
// which is why a fully static export is possible — no server actions, no route
// handlers, no dynamic route segments.
const nextConfig: NextConfig = {
  output: "export",

  // Emit `mix/session/index.html` instead of `mix/session.html`. Tauri's asset
  // protocol resolves directory paths to index.html but will not append `.html`,
  // so without this every route but `/` 404s inside the app.
  trailingSlash: true,

  // No server means no image optimizer. (Nothing uses next/image today; this
  // keeps the build from failing the day something does.)
  images: { unoptimized: true },
};

export default nextConfig;
