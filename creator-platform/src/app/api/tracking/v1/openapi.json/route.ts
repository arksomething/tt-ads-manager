import { trackingOpenApi } from "@/server/tracking-api/openapi";
export function GET() {
  return Response.json(trackingOpenApi, { headers: { "cache-control": "public, max-age=300" } });
}
