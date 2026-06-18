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

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) return NextResponse.json({ error: "missing url" }, { status: 400 });

  let hostname = url;
  try { hostname = new URL(url).hostname.replace("www.", ""); } catch {}

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
