import { handleTrackingWorker } from "@/server/tracking-api/handler";
export const runtime = "nodejs";
export async function POST(request: Request) { return handleTrackingWorker(request, "sync"); }
