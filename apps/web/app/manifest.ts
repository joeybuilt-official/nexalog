import type { MetadataRoute } from "next";

/**
 * PWA manifest + share_target (Phase 1 acceptance: "from Android Chrome share
 * a URL/PDF/photo and record a voice note"). The share_target is a POST
 * multipart form to /api/capture — same endpoint the bookmarklet + in-app use.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Nexalog",
    short_name: "Nexalog",
    description: "Your digital brain, captured.",
    start_url: "/inbox",
    display: "standalone",
    background_color: "#faf6f0",
    theme_color: "#faf6f0",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
    share_target: {
      action: "/api/capture",
      method: "POST",
      enctype: "multipart/form-data",
      params: {
        title: "text",
        text: "text",
        url: "url",
        files: [{ name: "file", accept: ["*/*"] }],
      },
    },
  };
}
