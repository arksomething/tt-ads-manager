import { handleCreatorTrackerMonitorHeartbeat } from "@/server/creator-tracker/monitor-handler";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleCreatorTrackerMonitorHeartbeat(request);
}
