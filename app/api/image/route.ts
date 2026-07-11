import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  fetchPublicUrl,
  readBodyCapped,
  UnsafeUrlError,
  BodyTooLargeError,
} from "@/lib/server/publicUrl";

// Node runtime: the public-URL guard resolves hostnames with node:dns.
export const runtime = "nodejs";

// Matches the 50 MB Storage object cap with plenty of headroom — anything
// bigger has no business becoming a library image.
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * Image proxy for "Add image by URL" (sidesteps CORS on the source site).
 * Signed-in users only; the target must be a public http(s) URL — see
 * lib/server/publicUrl for what's refused.
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse("unauthorized", { status: 401 });

  const url = req.nextUrl.searchParams.get("url");
  if (!url) return new NextResponse("missing url", { status: 400 });

  try {
    const res = await fetchPublicUrl(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; HotCocoaBot/1.0)" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    if (!contentType.startsWith("image/")) throw new Error("not an image");

    const body = await readBodyCapped(res, MAX_IMAGE_BYTES);
    return new NextResponse(Buffer.from(body), {
      headers: {
        "content-type": contentType,
        "cache-control": "public, max-age=3600",
      },
    });
  } catch (err) {
    if (err instanceof UnsafeUrlError) {
      return new NextResponse("that URL can't be fetched", { status: 400 });
    }
    if (err instanceof BodyTooLargeError) {
      return new NextResponse("image too large", { status: 413 });
    }
    return new NextResponse("couldn't fetch that image", { status: 502 });
  }
}
