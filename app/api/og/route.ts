import { NextRequest, NextResponse } from "next/server";
import { parse } from "node-html-parser";

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) return NextResponse.json({ error: "missing url" }, { status: 400 });

  let hostname = url;
  try { hostname = new URL(url).hostname.replace("www.", ""); } catch {}

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
