import { handleCreatorTrackerIngestionRequest } from "@/server/creator-tracker/ingestion-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return handleCreatorTrackerIngestionRequest(request);
}
