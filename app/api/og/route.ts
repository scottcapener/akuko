import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) return NextResponse.json({ error: "missing url" }, { status: 400 });

  try {
    const res = await fetch(url, {
      headers: {
        // Mimic a real browser so sites don't reject the request
        "User-Agent":
          "Mozilla/5.0 (compatible; AkukoBot/1.0; +https://akuko.app)",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const html = await res.text();

    function meta(property: string): string {
      // og:X and name=X
      const patterns = [
        new RegExp(
          `<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`,
          "i"
        ),
        new RegExp(
          `<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`,
          "i"
        ),
        new RegExp(
          `<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']+)["']`,
          "i"
        ),
        new RegExp(
          `<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${property}["']`,
          "i"
        ),
      ];
      for (const re of patterns) {
        const m = html.match(re);
        if (m?.[1]) return m[1].trim();
      }
      return "";
    }

    function titleTag(): string {
      const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      return m?.[1]?.trim() ?? "";
    }

    const title =
      meta("og:title") || meta("twitter:title") || titleTag() || new URL(url).hostname;
    const description =
      meta("og:description") || meta("twitter:description") || meta("description") || "";
    const image =
      meta("og:image") || meta("twitter:image") || meta("twitter:image:src") || "";

    return NextResponse.json({ title, description, image });
  } catch (err) {
    // Return a graceful fallback so the card still renders
    const hostname = (() => {
      try { return new URL(url).hostname.replace("www.", ""); } catch { return url; }
    })();
    return NextResponse.json(
      { title: hostname, description: "", image: "", error: String(err) },
      { status: 200 } // 200 so the client can still show a card
    );
  }
}
