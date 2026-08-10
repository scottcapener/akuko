import { fetchTips } from "@/lib/tips";

// Serves the ordered tip list to the writer's Tips card. `fetchTips` caches the
// underlying Google Sheet fetch for a day, so this handler is cheap to run per
// request (just re-parsed cached CSV) and always resolves to a non-empty list.
export async function GET() {
  const tips = await fetchTips();
  return Response.json({ tips });
}
