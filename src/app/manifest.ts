import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Yale NEPO",
    short_name: "NEPO",
    description: "Get into Yale clubs through people you already know.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#00356b",
    icons: [
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
