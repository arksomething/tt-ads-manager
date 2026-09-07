import { handleCreatorTrackerIngestionRequest } from "@/server/creator-tracker/ingestion-handler";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleCreatorTrackerIngestionRequest(request);
}
