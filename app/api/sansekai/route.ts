import { NextRequest, NextResponse } from "next/server";

const API_BASE = "https://api.sansekai.my.id/api";
const PLATFORMS = [
  "pinedrama", "dramabox", "reelshort", "shortmax", "freereels",
  "dramanova", "anime", "moviebox",
] as const;
type Platform = typeof PLATFORMS[number];
type Action = "home" | "search" | "detail" | "play" | "media";
type JsonObject = Record<string, unknown>;
type CatalogItem = {
  id: string;
  title: string;
  cover: string;
  description: string;
  episodes: number;
  tags: string[];
  platform: Platform;
};

const HOME_FEEDS: Record<Platform, string[]> = {
  pinedrama: ["foryou", "trending"],
  dramabox: ["trending", "latest", "dubindo", "vip", "foryou"],
  reelshort: ["homepage", "foryou"],
  shortmax: ["latest", "rekomendasi", "vip", "foryou"],
  freereels: ["homepage", "animepage", "foryou"],
  dramanova: ["home", "komik"],
  anime: ["latest", "recommended", "movie"],
  moviebox: ["homepage", "k-drama", "indo-movies", "hollywood-movies"],
};

const cache = new Map<string, { until: number; status: number; payload: unknown }>();

function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function firstString(object: JsonObject, keys: string[]) {
  for (const key of keys) {
    const value = object[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return "";
}

function firstNumber(object: JsonObject, keys: string[]) {
  for (const key of keys) {
    const value = Number(object[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  const lastChapter = firstString(object, ["lastch", "episode_label"]);
  const match = lastChapter.match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function walk(value: unknown, visit: (object: JsonObject) => void, depth = 0) {
  if (depth > 8 || !value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item) => walk(item, visit, depth + 1));
    return;
  }
  const object = value as JsonObject;
  visit(object);
  Object.values(object).forEach((item) => walk(item, visit, depth + 1));
}

function normalizeCatalog(platform: Platform, payload: unknown) {
  const items: CatalogItem[] = [];
  const seen = new Set<string>();

  walk(payload, (object) => {
    const title = firstString(object, [
      "title", "bookName", "book_title", "name", "shortPlayName", "judul",
      "subjectTitle", "subject", "dramaName", "seriesName", "collectionName",
      "anime_name", "movieName",
    ]);
    const cover = firstString(object, [
      "cover", "coverWap", "cover_url", "coverUrl", "picUrl", "poster",
      "posterImg", "image", "thumbnail", "subjectCover", "verticalCover",
      "collectionCover", "anime_cover",
    ]);
    let id = firstString(object, [
      "collection_id", "collectionId", "bookId", "book_id", "shortPlayId", "key", "dramaId",
      "drama_id", "urlId", "subjectId", "subject_id", "series_id", "slug",
    ]);
    if (!id && platform === "anime") id = firstString(object, ["url"]);
    if (!id && cover && title) id = firstString(object, ["id"]);
    if (!id || !title || !/^https?:\/\//i.test(cover)) return;

    const unique = `${platform}:${id}`;
    if (seen.has(unique)) return;
    seen.add(unique);

    const rawTags = object.tags ?? object.tag ?? object.categories ?? object.content_tags;
    const tags = Array.isArray(rawTags)
      ? rawTags.filter((tag): tag is string => typeof tag === "string").slice(0, 4)
      : typeof rawTags === "string"
        ? rawTags.split(",").map((tag) => tag.trim()).filter(Boolean).slice(0, 4)
        : [];

    items.push({
      id,
      title,
      cover,
      description: firstString(object, ["description", "introduction", "desc", "summary", "synopsis"]),
      episodes: firstNumber(object, [
        "total_episodes", "chapterCount", "totalEpisodes", "episode_count",
        "episodeCount", "updateEpisode", "chapter_count", "totalEpisode",
      ]),
      tags,
      platform,
    });
  });

  return items.slice(0, 60);
}

function allowedPlatform(value: string): value is Platform {
  return (PLATFORMS as readonly string[]).includes(value);
}

function upstreamUrl(platform: Platform, action: Action, params: URLSearchParams) {
  let endpoint = "";
  const query = new URLSearchParams();
  const id = (params.get("id") ?? "").slice(0, 240);
  const episode = Math.max(1, Number(params.get("episode") ?? 1));

  if (action === "home") {
    const requested = params.get("feed") ?? HOME_FEEDS[platform][0];
    const feed = HOME_FEEDS[platform].includes(requested) ? requested : HOME_FEEDS[platform][0];
    endpoint = `/${platform}/${feed}`;
    if (params.get("page")) query.set("page", params.get("page")!.slice(0, 4));
  } else if (action === "search") {
    endpoint = `/${platform}/search`;
    query.set("query", (params.get("query") ?? "").slice(0, 100));
  } else if (action === "detail") {
    if (!id) throw new Error("ID konten tidak valid.");
    const detail: Record<Platform, [string, string]> = {
      pinedrama: ["detail", "collection_id"],
      dramabox: ["allepisode", "bookId"],
      reelshort: ["detail", "bookId"],
      shortmax: ["detail", "shortPlayId"],
      freereels: ["detailAndAllEpisode", "key"],
      dramanova: ["detail", "dramaId"],
      anime: ["detail", "urlId"],
      moviebox: ["detail", "subjectId"],
    };
    endpoint = `/${platform}/${detail[platform][0]}`;
    query.set(detail[platform][1], id);
    if (platform === "moviebox" && params.get("season")) query.set("season", params.get("season")!);
  } else if (action === "play") {
    if (!id && platform !== "dramabox") throw new Error("ID konten tidak valid.");
    const play: Record<Exclude<Platform, "freereels">, [string, string]> = {
      pinedrama: ["episode", "collection_id"],
      dramabox: ["decrypt", "url"],
      reelshort: ["episode", "bookId"],
      shortmax: ["episode", "shortPlayId"],
      dramanova: ["getvideo", "fileId"],
      anime: ["getvideo", "chapterUrlId"],
      moviebox: ["get-download-url", "subjectId"],
    };
    if (platform === "freereels") throw new Error("Video FreeReels sudah tersedia di detail.");
    endpoint = `/${platform}/${play[platform][0]}`;
    query.set(play[platform][1], platform === "dramabox" ? (params.get("url") ?? "").slice(0, 4000) : id);
    if (["pinedrama", "reelshort", "shortmax"].includes(platform)) query.set("episodeNumber", String(episode));
    if (platform === "anime") query.set("reso", (params.get("quality") ?? "480p").slice(0, 10));
    if (platform === "moviebox") {
      query.set("episode", String(Math.max(0, Number(params.get("episode") ?? 0))));
      query.set("season", String(Math.max(0, Number(params.get("season") ?? 0))));
    }
  }

  return `${API_BASE}${endpoint}?${query.toString()}`;
}

async function fetchJson(url: string, ttl: number) {
  const cached = cache.get(url);
  if (cached && cached.until > Date.now()) return cached;

  const response = await fetch(url, {
    headers: {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
      Referer: "https://api.sansekai.my.id/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138 Safari/537.36",
    },
    redirect: "follow",
    cf: { cacheEverything: true, cacheTtl: Math.max(60, Math.floor(ttl / 1000)) },
  } as RequestInit & { cf: { cacheEverything: boolean; cacheTtl: number } });
  const payload = await response.json().catch(() => ({ error: "Respons API tidak valid." }));
  const result = { until: Date.now() + ttl, status: response.status, payload };
  if (response.ok) cache.set(url, result);
  return result;
}

function homeCandidates(platform: Platform, params: URLSearchParams) {
  const requested = params.get("feed") ?? HOME_FEEDS[platform][0];
  const feeds = [requested, ...HOME_FEEDS[platform]].filter(
    (feed, index, values) => HOME_FEEDS[platform].includes(feed) && values.indexOf(feed) === index,
  );
  const urls = feeds.slice(0, 3).map((feed) => {
    const candidate = new URLSearchParams(params);
    candidate.set("feed", feed);
    return upstreamUrl(platform, "home", candidate);
  });
  return urls;
}

function mediaProxyUrl(request: NextRequest, url: string) {
  const proxy = new URL("/api/sansekai", request.nextUrl.origin);
  proxy.searchParams.set("platform", "shortmax");
  proxy.searchParams.set("action", "media");
  proxy.searchParams.set("url", url);
  return proxy.href;
}

async function decryptShortMaxSegment(bytes: Uint8Array) {
  if (bytes[0] === 0x47 || bytes.length < 1040) return bytes;
  const decoder = new TextDecoder("ascii");
  if (decoder.decode(bytes.slice(0, 8)) !== "shortmax") return bytes;

  try {
    const keyPosition = Number.parseInt(decoder.decode(bytes.slice(16, 20)), 10);
    const keyOffset = keyPosition - 24;
    const key = bytes.slice(24 + keyOffset, 24 + keyOffset + 16);
    const payload = bytes.slice(1040);
    const encrypted = new Uint8Array(16 + Math.min(1024, payload.length));
    encrypted.set(bytes.slice(1024, 1040));
    encrypted.set(payload.slice(0, 1024), 16);
    const cryptoKey = await crypto.subtle.importKey("raw", key, "AES-CBC", false, ["decrypt"]);
    const iv = new TextEncoder().encode("shortmax00000000");
    const first = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-CBC", iv }, cryptoKey, encrypted));
    const output = new Uint8Array(first.length + Math.max(0, payload.length - 1024));
    output.set(first);
    output.set(payload.slice(1024), first.length);
    return output;
  } catch {
    return bytes.slice(1040);
  }
}

async function handleMedia(request: NextRequest) {
  const rawUrl = request.nextUrl.searchParams.get("url") ?? "";
  let url: URL;
  try { url = new URL(rawUrl); } catch { return new NextResponse("URL media tidak valid.", { status: 400 }); }
  if (url.protocol !== "https:" || !url.hostname.endsWith("shorttv.live")) {
    return new NextResponse("Host media tidak diizinkan.", { status: 403 });
  }

  const response = await fetch(url, {
    headers: { Accept: "*/*", "Accept-Encoding": "identity", "User-Agent": "okhttp/4.12.0" },
    cache: "no-store",
  });
  if (!response.ok) return new NextResponse("Media tidak tersedia.", { status: response.status });
  const bytes = new Uint8Array(await response.arrayBuffer());
  const textStart = new TextDecoder().decode(bytes.slice(0, 16));
  const isPlaylist = url.pathname.includes(".m3u8") || textStart.includes("#EXTM3U");

  if (isPlaylist) {
    const base = response.url || url.href;
    const playlist = new TextDecoder().decode(bytes).split(/\r?\n/).map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith("#")) {
        return line.replace(/URI="([^"]+)"/g, (_match, uri: string) => {
          const absolute = new URL(uri, base).href;
          return `URI="${mediaProxyUrl(request, absolute)}"`;
        });
      }
      return mediaProxyUrl(request, new URL(trimmed, base).href);
    }).join("\n");
    return new NextResponse(playlist, {
      headers: { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store" },
    });
  }

  const output = await decryptShortMaxSegment(bytes);
  const body = output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength) as ArrayBuffer;
  return new NextResponse(body, {
    headers: { "Content-Type": "video/mp2t", "Cache-Control": "public, max-age=3600" },
  });
}

export async function GET(request: NextRequest) {
  const platformValue = request.nextUrl.searchParams.get("platform") ?? "pinedrama";
  const actionValue = request.nextUrl.searchParams.get("action") ?? "home";
  if (!allowedPlatform(platformValue) || !["home", "search", "detail", "play", "media"].includes(actionValue)) {
    return NextResponse.json({ error: "Permintaan tidak valid." }, { status: 400 });
  }
  const platform = platformValue as Platform;
  const action = actionValue as Action;

  if (action === "media") {
    if (platform !== "shortmax") return NextResponse.json({ error: "Media tidak valid." }, { status: 400 });
    return handleMedia(request);
  }

  try {
    const ttl = action === "play" ? 5 * 60_000 : action === "search" ? 3 * 60_000 : 15 * 60_000;
    const upstreams = action === "home"
      ? homeCandidates(platform, request.nextUrl.searchParams)
      : [upstreamUrl(platform, action, request.nextUrl.searchParams)];
    let lastStatus = 502;
    let sawRateLimit = false;

    for (const upstream of upstreams) {
      const result = await fetchJson(upstream, ttl);
      lastStatus = result.status;
      if (result.status === 429) {
        sawRateLimit = true;
        break;
      }
      if (result.status >= 400) continue;

      if (action === "home" || action === "search") {
        const items = normalizeCatalog(platform, result.payload);
        if (items.length || action === "search") {
          return NextResponse.json({ items }, {
            headers: { "Cache-Control": `public, s-maxage=${Math.floor(ttl / 1000)}, stale-while-revalidate=3600` },
          });
        }
        continue;
      }

      return NextResponse.json({ data: result.payload }, {
        headers: { "Cache-Control": `public, s-maxage=${Math.floor(ttl / 1000)}, stale-while-revalidate=300` },
      });
    }

    if (sawRateLimit) {
      return NextResponse.json({
        error: "API Sansekai sedang mencapai batas 10 request per menit. Tunggu sebentar lalu coba lagi.",
      }, { status: 429, headers: { "Retry-After": "60" } });
    }
    return NextResponse.json({
      error: `Konten Sansekai belum dapat dimuat (upstream ${lastStatus}).`,
    }, { status: lastStatus });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Layanan konten tidak dapat dijangkau.",
    }, { status: 502 });
  }
}

