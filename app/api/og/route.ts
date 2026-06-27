import { NextRequest, NextResponse } from "next/server";
import { parse } from "node-html-parser";

function extractYouTubeId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace("www.", "").replace("m.", "");
    if (host === "youtube.com") {
      if (parsed.pathname.startsWith("/shorts/") || parsed.pathname.startsWith("/live/")) {
        return parsed.pathname.split("/")[2] || null;
      }
      return parsed.searchParams.get("v");
    }
    if (host === "youtu.be") return parsed.pathname.slice(1) || null;
  } catch {}
  return null;
}

// Apple Music links serve generic placeholder OG tags to bots (the real
// metadata is rendered client-side), so scrape the page and you get
// "Apple Music Web Player" + a logo. The credential-free iTunes Lookup API
// returns clean structured data instead. The `?i=` param is the song id;
// otherwise the trailing path id is the album/song/artist id.
function extractAppleMusicId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.replace("www.", "").endsWith("music.apple.com")) return null;
    const songId = parsed.searchParams.get("i");
    if (songId && /^\d+$/.test(songId)) return songId;
    const last = parsed.pathname.split("/").filter(Boolean).pop() ?? "";
    return /^\d+$/.test(last) ? last : null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) return NextResponse.json({ error: "missing url" }, { status: 400 });

  let hostname = url;
  try { hostname = new URL(url).hostname.replace("www.", ""); } catch {}

  // Apple Music: use the iTunes Lookup API for accurate title + artist + artwork
  const appleId = extractAppleMusicId(url);
  if (appleId) {
    try {
      const lookupRes = await fetch(
        `https://itunes.apple.com/lookup?id=${appleId}`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (lookupRes.ok) {
        const data = await lookupRes.json();
        const r = data?.results?.[0];
        if (r) {
          // artworkUrl100 is templated — request a larger square instead of the 100px thumb
          const image = (r.artworkUrl100 || "").replace(/\/\d+x\d+bb\./, "/600x600bb.");
          return NextResponse.json({
            title: r.trackName || r.collectionName || r.artistName || hostname,
            description: r.artistName || "",
            image,
          });
        }
      }
    } catch {}
    // fall through to generic scrape on miss
  }

  // YouTube: use oEmbed for accurate title + channel name + thumbnail
  const ytId = extractYouTubeId(url);
  if (ytId) {
    try {
      const oembedRes = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (oembedRes.ok) {
        const oembed = await oembedRes.json();
        return NextResponse.json({
          title: oembed.title || hostname,
          description: oembed.author_name || "",
          // mqdefault is 320×180 and always available without letterboxing
          image: `https://img.youtube.com/vi/${ytId}/mqdefault.jpg`,
        });
      }
    } catch {}
  }

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; HotCocoaBot/1.0)",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const html = await res.text();
    const root = parse(html);

    function og(property: string) {
      return (
        root.querySelector(`meta[property="${property}"]`)?.getAttribute("content") ??
        root.querySelector(`meta[name="${property}"]`)?.getAttribute("content") ??
        ""
      );
    }

    const title =
      og("og:title") || og("twitter:title") ||
      root.querySelector("title")?.text?.trim() ||
      hostname;

    const description =
      og("og:description") || og("twitter:description") || og("description") || "";

    const image =
      og("og:image") || og("twitter:image") || og("twitter:image:src") || "";

    return NextResponse.json({ title, description, image });
  } catch (err) {
    // Graceful fallback — card still renders
    return NextResponse.json(
      { title: hostname, description: "", image: "", error: String(err) },
      { status: 200 }
    );
  }
}
