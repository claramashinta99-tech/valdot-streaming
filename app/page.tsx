import type { Metadata } from "next";
import StreamingApp from "./streaming-app";

export const metadata: Metadata = {
  title: "Valdot — Drama, Anime, dan Film",
  description: "Streaming dracin, drakor, anime, dan film pilihan tanpa login.",
};

export default function Home() {
  return <StreamingApp />;
}
