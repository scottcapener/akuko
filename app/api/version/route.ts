import { APP_VERSION } from "@/lib/version";

// The live version of the running deployment. Never cached or prerendered, so an
// open tab polling this always sees the number the currently-deployed build
// carries — the moment a new deploy lands, this reflects it. The service worker
// (public/sw.js) passes /api/* straight to the network, so it's never served a
// stale copy either.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ version: APP_VERSION });
}
