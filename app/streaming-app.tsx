"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type Platform = "pinedrama" | "dramabox" | "reelshort" | "shortmax" | "freereels" | "dramanova" | "anime" | "moviebox";
type Mode = { id: string; label: string; platform: Platform; feed: string; caption: string };
type MediaItem = {
  id: string;
  title: string;
  cover: string;
  description: string;
  episodes: number;
  tags: string[];
  platform: Platform;
};
type Subtitle = { src: string; label: string; lang: string };
type Quality = { label: string; url: string };
type Episode = {
  number: number;
  title: string;
  playId?: string;
  streamUrl?: string;
  rawUrl?: string;
  season?: number;
  qualities?: Quality[];
  subtitles?: Subtitle[];
};
type JsonObject = Record<string, unknown>;

const MODES: Mode[] = [
  { id: "pilihan", label: "Pilihan", platform: "dramabox", feed: "trending", caption: "Drama pendek pilihan hari ini" },
  { id: "dracin", label: "Dracin", platform: "dramabox", feed: "trending", caption: "Drama China pendek terpopuler" },
  { id: "anime", label: "Anime", platform: "anime", feed: "latest", caption: "Anime terbaru subtitle Indonesia" },
  { id: "drakor", label: "Drakor", platform: "moviebox", feed: "k-drama", caption: "Serial Korea dalam satu tempat" },
  { id: "film-indo", label: "Film Indo", platform: "moviebox", feed: "indo-movies", caption: "Pilihan film Indonesia" },
  { id: "hollywood", label: "Hollywood", platform: "moviebox", feed: "hollywood-movies", caption: "Film dan serial internasional" },
  { id: "reelshort", label: "ReelShort", platform: "reelshort", feed: "homepage", caption: "Cerita singkat untuk maraton" },
  { id: "shortmax", label: "ShortMax", platform: "shortmax", feed: "latest", caption: "Rilis drama pendek terbaru" },
  { id: "freereels", label: "FreeReels", platform: "freereels", feed: "homepage", caption: "Drama gratis lintas genre" },
  { id: "dramanova", label: "DramaNova", platform: "dramanova", feed: "home", caption: "Koleksi drama dan hiburan Asia" },
];

function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function walkObjects(value: unknown, output: JsonObject[] = [], depth = 0) {
  if (depth > 9 || !value || typeof value !== "object") return output;
  if (Array.isArray(value)) {
    value.forEach((item) => walkObjects(item, output, depth + 1));
    return output;
  }
  const object = value as JsonObject;
  output.push(object);
  Object.values(object).forEach((item) => walkObjects(item, output, depth + 1));
  return output;
}

function textOf(object: JsonObject, keys: string[]) {
  for (const key of keys) {
    const value = object[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return "";
}

function numberOf(object: JsonObject, keys: string[]) {
  for (const key of keys) {
    const value = Number(object[key]);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return 0;
}

function apiUrl(platform: Platform, action: string, params: Record<string, string | number> = {}) {
  const query = new URLSearchParams({ platform, action });
  Object.entries(params).forEach(([key, value]) => query.set(key, String(value)));
  return `/api/sansekai?${query.toString()}`;
}

async function callApi(platform: Platform, action: string, params: Record<string, string | number> = {}) {
  const response = await fetch(apiUrl(platform, action, params));
  const payload = await response.json().catch(() => ({ error: "Respons server tidak valid." }));
  if (!response.ok || payload.error) throw new Error(payload.error ?? "Konten gagal dimuat.");
  return payload;
}

function generatedEpisodes(total: number) {
  return Array.from({ length: Math.max(1, total) }, (_, index) => ({
    number: index + 1,
    title: `Episode ${index + 1}`,
  }));
}

function subtitleList(object: JsonObject): Subtitle[] {
  const raw = object.subtitle_list ?? object.subtitles;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!isObject(item)) return [];
    const src = textOf(item, ["vtt", "url", "src", "subtitle"]);
    if (!src) return [];
    return [{
      src,
      label: textOf(item, ["display_name", "label", "language"]) || "Subtitle",
      lang: textOf(item, ["language", "lang"]) || "id",
    }];
  });
}

function extractEpisodes(platform: Platform, raw: unknown, fallbackTotal: number) {
  if (platform === "dramabox" && Array.isArray(raw)) {
    return raw.flatMap((value, index): Episode[] => {
      if (!isObject(value)) return [];
      const cdnList = Array.isArray(value.cdnList) ? value.cdnList.filter(isObject) : [];
      const preferred = cdnList.find((cdn) => Number(cdn.isDefault) === 1) ?? cdnList[0];
      const paths = preferred && Array.isArray(preferred.videoPathList)
        ? preferred.videoPathList.filter(isObject)
        : [];
      const qualities = paths.flatMap((path): Quality[] => {
        const url = textOf(path, ["videoPath"]);
        return url ? [{ label: `${numberOf(path, ["quality"])}p`, url }] : [];
      }).sort((a, b) => Number.parseInt(b.label) - Number.parseInt(a.label));
      const selected = paths.find((path) => Number(path.isDefault) === 1) ?? paths[0];
      return [{
        number: numberOf(value, ["chapterIndex"]) + 1 || index + 1,
        title: textOf(value, ["chapterName", "title"]) || `Episode ${index + 1}`,
        rawUrl: selected ? textOf(selected, ["videoPath"]) : undefined,
        qualities,
      }];
    });
  }

  if (platform === "freereels" && isObject(raw)) {
    const data = isObject(raw.data) ? raw.data : raw;
    const info = isObject(data.info) ? data.info : data;
    if (Array.isArray(info.episode_list)) {
      return info.episode_list.flatMap((value, index): Episode[] => {
        if (!isObject(value)) return [];
        const stream = textOf(value, ["external_audio_h264_m3u8", "m3u8_url", "video_url"]);
        return [{
          number: numberOf(value, ["episode_num", "episodeNumber", "episode", "sort"]) || index + 1,
          title: `Episode ${index + 1}`,
          streamUrl: stream || undefined,
          subtitles: subtitleList(value),
        }];
      });
    }
  }

  const episodes: Episode[] = [];
  const seen = new Set<string>();
  for (const object of walkObjects(raw)) {
    const title = textOf(object, ["chapterName", "chapter_name", "episodeName", "episode_name", "name", "title", "judul"]);
    let number = numberOf(object, ["episodeNumber", "episode_num", "episodeNum", "episode", "episode_no", "chapter", "sort"]);
    if (!number) number = Number(title.match(/(?:episode|ep)\s*(\d+)/i)?.[1] ?? 0);
    const playId = textOf(object, ["fileId", "file_id", "chapterUrlId", "chapter_url_id", "url", "videoId", "video_id"]);
    const streamUrl = textOf(object, ["best_url", "streamUrl", "video_url", "m3u8_url", "external_audio_h264_m3u8"]);
    const looksLikeEpisode = number > 0 || /episode|\bep\s*\d+/i.test(title);
    const platformId = platform === "anime" || platform === "dramanova" ? playId : playId || streamUrl;
    if (!looksLikeEpisode || !platformId) continue;
    const key = `${number}:${platformId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    episodes.push({
      number: number || episodes.length + 1,
      title: title || `Episode ${number || episodes.length + 1}`,
      playId: playId || undefined,
      streamUrl: /^https?:\/\//i.test(streamUrl) ? streamUrl : undefined,
      season: numberOf(object, ["season", "seasonNumber", "season_number"]),
      subtitles: subtitleList(object),
    });
  }
  episodes.sort((a, b) => a.number - b.number);
  return episodes.length ? episodes : generatedEpisodes(fallbackTotal || 1);
}

function collectVideoOptions(raw: unknown, platform: Platform) {
  const options: Quality[] = [];
  const seen = new Set<string>();
  for (const object of walkObjects(raw)) {
    for (const [key, value] of Object.entries(object)) {
      if (typeof value !== "string" || !/^https?:\/\//i.test(value)) continue;
      if (!/(video|stream|m3u8|download|best_url|url_\d|play)/i.test(key)) continue;
      if (/\.(?:jpg|jpeg|png|webp|gif)(?:\?|$)/i.test(value)) continue;
      let url = value;
      if (platform === "shortmax" && /\.m3u8(?:\?|$)/i.test(url)) {
        url = apiUrl("shortmax", "media", { url });
      }
      if (seen.has(url)) continue;
      seen.add(url);
      const quality = key.match(/(1080|720|540|480|360|240|144)/)?.[1];
      options.push({ label: quality ? `${quality}p` : options.length ? `Sumber ${options.length + 1}` : "Auto", url });
    }
  }
  return options.sort((a, b) => Number.parseInt(b.label) - Number.parseInt(a.label));
}

export default function StreamingApp() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [modeId, setModeId] = useState(MODES[0].id);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [selected, setSelected] = useState<MediaItem | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [currentEpisode, setCurrentEpisode] = useState<Episode | null>(null);
  const [qualities, setQualities] = useState<Quality[]>([]);
  const [videoUrl, setVideoUrl] = useState("");
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [playerLoading, setPlayerLoading] = useState(false);
  const [error, setError] = useState("");

  const mode = useMemo(() => MODES.find((item) => item.id === modeId) ?? MODES[0], [modeId]);
  const featured = items[0];

  const loadCatalog = useCallback(async (search = "") => {
    setLoading(true);
    setError("");
    setSelected(null);
    setCurrentEpisode(null);
    setVideoUrl("");
    try {
      const payload = await callApi(mode.platform, search ? "search" : "home", search
        ? { query: search }
        : { feed: mode.feed });
      setItems(Array.isArray(payload.items) ? payload.items : []);
      setActiveQuery(search);
    } catch (reason) {
      setItems([]);
      setError(reason instanceof Error ? reason.message : "Konten gagal dimuat.");
    } finally {
      setLoading(false);
    }
  }, [mode]);

  useEffect(() => { loadCatalog(); }, [loadCatalog]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;
    let cancelled = false;
    let hls: { destroy: () => void } | null = null;
    const isHls = /\.m3u8(?:$|\?)/i.test(videoUrl) || videoUrl.includes("action=media");

    if (!isHls || video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = videoUrl;
      video.play().catch(() => undefined);
    } else {
      import("hls.js").then(({ default: Hls }) => {
        if (cancelled) return;
        if (!Hls.isSupported()) throw new Error("HLS tidak didukung");
        const instance = new Hls({ enableWorker: true });
        hls = instance;
        instance.loadSource(videoUrl);
        instance.attachMedia(video);
        instance.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => undefined));
        instance.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) setError("Video gagal dimuat dari sumber. Coba kualitas atau episode lain.");
        });
      }).catch(() => setError("Pemutar video gagal disiapkan."));
    }
    return () => {
      cancelled = true;
      hls?.destroy();
      video.removeAttribute("src");
      video.load();
    };
  }, [videoUrl]);

  async function openItem(item: MediaItem) {
    setSelected(item);
    setEpisodes([]);
    setCurrentEpisode(null);
    setVideoUrl("");
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });

    const canGenerate = ["pinedrama", "reelshort", "shortmax"].includes(item.platform) && item.episodes > 0;
    if (canGenerate) {
      setEpisodes(generatedEpisodes(item.episodes));
      return;
    }

    setDetailLoading(true);
    try {
      const payload = await callApi(item.platform, "detail", { id: item.id });
      setEpisodes(extractEpisodes(item.platform, payload.data, item.episodes));
    } catch (reason) {
      setEpisodes(generatedEpisodes(item.episodes || 1));
      setError(reason instanceof Error ? reason.message : "Detail gagal dimuat.");
    } finally {
      setDetailLoading(false);
    }
  }

  async function playEpisode(episode: Episode) {
    if (!selected) return;
    setPlayerLoading(true);
    setError("");
    try {
      let options = episode.qualities ?? [];
      if (episode.streamUrl) options = [{ label: "Auto", url: episode.streamUrl }];

      if (!options.length) {
        const params: Record<string, string | number> = {
          id: selected.id,
          episode: episode.number,
        };
        if (selected.platform === "dramabox" && episode.rawUrl) params.url = episode.rawUrl;
        if (["anime", "dramanova"].includes(selected.platform) && episode.playId) params.id = episode.playId;
        if (episode.season) params.season = episode.season;
        const payload = await callApi(selected.platform, "play", params);
        options = collectVideoOptions(payload.data, selected.platform);
      }

      if (!options.length) throw new Error("Link video untuk episode ini belum tersedia dari sumber.");
      setCurrentEpisode(episode);
      setQualities(options);
      setVideoUrl(options[0].url);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Episode gagal dimuat.");
    } finally {
      setPlayerLoading(false);
    }
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const clean = query.trim();
    if (clean.length >= 2) loadCatalog(clean);
  }

  function goHome() {
    setQuery(activeQuery);
    loadCatalog(activeQuery);
  }

  if (selected) {
    return (
      <main className="app-shell detail-view">
        <Header query={query} setQuery={setQuery} submitSearch={submitSearch} onBrand={goHome} />
        <section className="detail-stage">
          {currentEpisode && videoUrl ? (
            <div className="watch-layout">
              <div className="video-frame">
                <video ref={videoRef} poster={selected.cover} controls autoPlay playsInline>
                  {currentEpisode.subtitles?.map((subtitle) => (
                    <track key={`${subtitle.lang}-${subtitle.src}`} kind="subtitles" src={subtitle.src} label={subtitle.label} srcLang={subtitle.lang} />
                  ))}
                </video>
              </div>
              <div className="watch-meta">
                <div>
                  <span className="kicker">SEDANG DIPUTAR Â· {MODES.find((item) => item.platform === selected.platform)?.label ?? selected.platform}</span>
                  <h1>{selected.title}</h1>
                  <p>Episode {currentEpisode.number}</p>
                </div>
                {qualities.length > 1 && (
                  <label className="quality-control">Kualitas
                    <select value={videoUrl} onChange={(event) => setVideoUrl(event.target.value)}>
                      {qualities.map((quality) => <option key={quality.url} value={quality.url}>{quality.label}</option>)}
                    </select>
                  </label>
                )}
              </div>
            </div>
          ) : (
            <div className="detail-cover" style={{ backgroundImage: `linear-gradient(90deg, rgba(8,11,10,.98) 8%, rgba(8,11,10,.72) 58%, rgba(8,11,10,.2)), url("${selected.cover}")` }}>
              <div className="detail-copy">
                <button className="ghost-button" onClick={goHome}>â† Kembali</button>
                <span className="kicker">{mode.label.toUpperCase()} Â· TANPA LOGIN</span>
                <h1>{selected.title}</h1>
                <p>{selected.description || "Pilih episode dan langsung mulai menonton."}</p>
                <div className="tag-row">
                  {!!selected.episodes && <span>{selected.episodes} episode</span>}
                  {selected.tags.map((tag) => <span key={tag}>{tag}</span>)}
                </div>
                <button className="accent-button" disabled={!episodes.length || playerLoading} onClick={() => episodes[0] && playEpisode(episodes[0])}>
                  {playerLoading ? "Menyiapkanâ€¦" : "â–¶ Mulai menonton"}
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="episode-panel">
          <div className="section-title">
            <div><span className="kicker">DAFTAR PUTAR</span><h2>Semua episode</h2></div>
            <span>{episodes.length} episode</span>
          </div>
          {error && <Notice message={error} />}
          {detailLoading ? <div className="loading-line">Mengambil semua episodeâ€¦</div> : (
            <div className="episode-grid">
              {episodes.map((episode) => (
                <button key={`${episode.number}-${episode.playId ?? ""}`} className={currentEpisode?.number === episode.number ? "active" : ""} onClick={() => playEpisode(episode)} disabled={playerLoading}>
                  <strong>{currentEpisode?.number === episode.number ? "â–¶" : String(episode.number).padStart(2, "0")}</strong>
                  <span>{episode.title}</span>
                </button>
              ))}
            </div>
          )}
        </section>
        <Footer />
      </main>
    );
  }

  return (
    <main className="app-shell">
      <Header query={query} setQuery={setQuery} submitSearch={submitSearch} onBrand={() => loadCatalog()} />
      <nav className="mode-nav" aria-label="Kategori konten">
        {MODES.map((item) => (
          <button key={item.id} className={item.id === modeId ? "active" : ""} onClick={() => { setModeId(item.id); setQuery(""); setActiveQuery(""); }}>
            {item.label}
          </button>
        ))}
      </nav>

      <section className="hero" style={featured ? { backgroundImage: `linear-gradient(90deg, rgba(8,11,10,.98) 4%, rgba(8,11,10,.68) 58%, rgba(8,11,10,.2)), url("${featured.cover}")` } : undefined}>
        <div className="hero-copy">
          <span className="kicker">{activeQuery ? "HASIL PENCARIAN" : mode.caption.toUpperCase()}</span>
          <h1>{featured?.title ?? "Satu tempat untuk semua cerita."}</h1>
          <p>{featured?.description || "Dracin, drakor, anime, dan film pilihan. Langsung nonton tanpa akun."}</p>
          {featured && <button className="accent-button" onClick={() => openItem(featured)}>Lihat episode <span>â†—</span></button>}
        </div>
        <div className="hero-mark">V</div>
      </section>

      <section className="catalog-panel">
        <div className="section-title">
          <div>
            <span className="kicker">{activeQuery ? "DITEMUKAN UNTUKMU" : "KOLEKSI TERBARU"}</span>
            <h2>{activeQuery ? `â€œ${activeQuery}â€` : mode.label}</h2>
          </div>
          <span>{items.length} judul</span>
        </div>
        {error && <Notice message={error} retry={() => loadCatalog(activeQuery)} />}
        {loading ? (
          <div className="media-grid">{Array.from({ length: 12 }, (_, index) => <div className="skeleton-card" key={index} />)}</div>
        ) : items.length ? (
          <div className="media-grid">
            {items.map((item) => (
              <button className="media-card" key={`${item.platform}-${item.id}`} onClick={() => openItem(item)}>
                <div className="poster">
                  <img src={item.cover} alt="" loading="lazy" />
                  <span className="poster-action">â–¶</span>
                  {!!item.episodes && <span className="episode-badge">{item.episodes} EP</span>}
                </div>
                <strong>{item.title}</strong>
                <span>{mode.label}{item.tags[0] ? ` Â· ${item.tags[0]}` : ""}</span>
              </button>
            ))}
          </div>
        ) : !error && <div className="empty-state">Belum ada judul di kategori ini.</div>}
      </section>
      <Footer />
    </main>
  );
}

function Header({ query, setQuery, submitSearch, onBrand }: {
  query: string;
  setQuery: (value: string) => void;
  submitSearch: (event: FormEvent) => void;
  onBrand: () => void;
}) {
  return (
    <header className="topbar">
      <button className="brand" onClick={onBrand}>VAL<span>DOT</span></button>
      <form className="search-box" onSubmit={submitSearch}>
        <span>âŒ•</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari drama, anime, atau filmâ€¦" aria-label="Cari konten" />
        <button type="submit">Cari</button>
      </form>
      <div className="no-login">TANPA LOGIN <i /></div>
    </header>
  );
}

function Notice({ message, retry }: { message: string; retry?: () => void }) {
  return <div className="notice"><span>{message}</span>{retry && <button onClick={retry}>Coba lagi</button>}</div>;
}

function Footer() {
  return (
    <footer>
      <div className="brand">VAL<span>DOT</span></div>
      <p>Agregator pemutar tanpa login. Data dan video berasal dari Sansekai API.</p>
      <a href="https://api.sansekai.my.id" target="_blank" rel="noreferrer">Sumber API â†—</a>
    </footer>
  );
}

