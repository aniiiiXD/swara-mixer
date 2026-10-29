// Where the Tonic backend lives — resolved at runtime, not baked at build time.
//
// The desktop build is a static export, so NEXT_PUBLIC_API_URL cannot carry the
// answer: the Tauri shell picks a free port at launch (8008 may already be taken
// by `make dev`) and injects it as `window.__TONIC_API__` before any page script
// runs. In a plain browser that global is absent and we fall back to the env var,
// then to the dev default.
//
// `typeof window` is checked because this module is also evaluated during
// prerendering, where no browser globals exist.

declare global {
  interface Window {
    __TONIC_API__?: string;
  }
}

export const API_ORIGIN: string =
  (typeof window !== "undefined" ? window.__TONIC_API__ : undefined) ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://127.0.0.1:8008";
