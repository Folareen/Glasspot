import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Glasspot",
    short_name: "Glasspot",
    description:
      "Group money, governed by agreement. Pool money with people you trust and only move it when the rule you agreed on is met.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#e3e6e9",
    theme_color: "#0f6e5f",
    icons: [
      {
        src: "/favicon.ico",
        sizes: "48x48",
        type: "image/x-icon",
      },
    ],
  };
}
