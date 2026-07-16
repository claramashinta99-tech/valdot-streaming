import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://valdot.web.id"),
  title: {
    default: "Valdot — Drama, Anime, dan Film",
    template: "%s · Valdot",
  },
  description: "Streaming dracin, drakor, anime, dan film pilihan tanpa login.",
  openGraph: {
    title: "Valdot — Drama, Anime, dan Film",
    description: "Drama, anime, dan film. Tanpa ribet.",
    type: "website",
    locale: "id_ID",
    siteName: "Valdot",
    images: [{
      url: "/og-sansekai.png",
      width: 1738,
      height: 909,
      alt: "Valdot — Drama, anime, dan film. Tanpa ribet.",
    }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Valdot — Drama, Anime, dan Film",
    description: "Drama, anime, dan film. Tanpa ribet.",
    images: ["/og-sansekai.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="id"><body>{children}</body></html>;
}
