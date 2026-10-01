import Link from "next/link";
import { trackingOpenApi } from "@/server/tracking-api/openapi";

export const metadata = { title: "Video Tracking API Reference" };
const example = `curl -X POST "$BASE_URL/api/tracking/v1/subscriptions" \\
  -H "Authorization: Bearer $TRACKING_API_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: creator-account-001" \\
  -d '{"url":"https://www.tiktok.com/@example","metadata":{"campaign":"launch"}}'`;

export default function TrackingApiDocs() {
  return <main className="mx-auto max-w-5xl px-5 py-12 text-zinc-900 [overflow-wrap:anywhere] sm:px-8">
    <nav className="mb-8 flex flex-wrap gap-5 text-sm"><Link href="/">Creator Platform</Link><a href="/api/tracking/v1/openapi.json" className="underline">OpenAPI JSON</a><a href="#endpoints" className="underline">Endpoints</a></nav>
    <h1 className="text-3xl font-semibold">Video Tracking API</h1>
    <p className="mt-3 max-w-3xl text-zinc-600">Version 1. Track TikTok and Instagram profiles or videos, retrieve collection status, and read metric history.</p>
    <section className="mt-10 border-t border-zinc-200 pt-6">
      <h2 className="text-xl font-semibold">Authentication</h2>
      <p className="mt-3">Send <code>Authorization: Bearer trk_live_...</code> on every API request. An operator provisions the organization and its first key. Keep keys on your server. Each key belongs to one organization.</p>
      <p className="mt-3">Scopes: <code>tracking:read</code>, <code>tracking:write</code>, and <code>keys:manage</code>. Use the keys endpoints to create replacements and revoke old credentials. Tokens are shown once.</p>
    </section>
    <section className="mt-8 border-t border-zinc-200 pt-6">
      <h2 className="text-xl font-semibold">First Request</h2>
      <p className="mt-3">Set <code>BASE_URL</code> to this site&apos;s HTTPS origin and <code>TRACKING_API_KEY</code> to your organization&apos;s key.</p>
      <pre className="mt-4 overflow-x-auto rounded border border-zinc-200 bg-zinc-50 p-4 text-xs leading-6"><code>{example}</code></pre>
      <ol className="mt-4 list-decimal space-y-2 pl-6">
        <li>The response returns a subscription ID and a nullable <code>job_id</code>.</li>
        <li>When a job is present, poll <code>GET /api/tracking/v1/jobs/&#123;id&#125;</code> until it succeeds or fails. Wait at least 15 seconds between polls.</li>
        <li>Read <code>GET /api/tracking/v1/videos?subscription_id=&#123;id&#125;</code>.</li>
        <li>Fetch history with <code>GET /api/tracking/v1/videos/&#123;id&#125;/observations</code>.</li>
      </ol>
    </section>
    <section className="mt-8 border-t border-zinc-200 pt-6">
      <h2 className="text-xl font-semibold">Collection Contract</h2>
      <ul className="mt-3 list-disc space-y-2 pl-6">
        <li>Use full HTTPS profile or video URLs. Short links and unsupported hosts are rejected. Instagram submissions also require the numeric owner <code>native_account_id</code>.</li>
        <li>Active targets are scheduled every 12 hours, subject to provider capacity. Account discovery returns up to ten recent videos. A <code>capped</code> scan is not complete historical coverage.</li>
        <li>Submit individual videos for continued polling beyond the recent account-discovery window. Pausing retains read access; deleting removes access through that subscription. In-flight collection may finish.</li>
        <li>Requests for the same target can share collection. Your metadata, subscriptions, and credentials remain private to your organization.</li>
        <li>Read <code>observed_at</code> and <code>source_observed_at</code> to assess freshness. Missing or unsupported counters remain <code>null</code>. <code>is_complete</code> means a view count was available, not that every metric exists.</li>
        <li>Empty profiles remain <code>empty_unconfirmed</code>. Failures never create zero-valued observations. A failed job includes <code>error_code</code>; the subscription exposes the next retry time.</li>
        <li>These provider observations are not independently raw-verified evidence for payout finalization. Collection timestamps are never backdated.</li>
      </ul>
    </section>
    <section className="mt-8 border-t border-zinc-200 pt-6">
      <h2 className="text-xl font-semibold">Limits and Retries</h2>
      <p className="mt-3">Defaults are 100 subscriptions and 120 requests per minute per organization, shared across its keys. <code>GET /organization</code> returns your limits. A manual refresh is allowed once an hour after the last successful collection. Provider capacity is separately bounded.</p>
      <p className="mt-3">Use a unique <code>Idempotency-Key</code> for submissions and refreshes. Retry the same request with the same key after a timeout. Changed input with a reused key returns <code>409 IDEMPOTENCY_CONFLICT</code>. For <code>429</code>, wait the number of seconds in <code>Retry-After</code>. For <code>503</code>, retry with exponential backoff.</p>
      <p className="mt-3">Lists accept <code>limit</code> (1-100) and <code>after</code>. Pass the returned <code>next_cursor</code> until it is null. Results are ordered by ID; sort observations by timestamp for charts. Responses contain <code>x-request-id</code> for support and use <code>Cache-Control: private, no-store</code>.</p>
    </section>
    <section id="endpoints" className="mt-8 border-t border-zinc-200 pt-6">
      <h2 className="text-xl font-semibold">Endpoints</h2>
      <p className="mt-3">Base path: <code>/api/tracking/v1</code>. Download the <a className="underline" href="/api/tracking/v1/openapi.json">OpenAPI contract</a> for complete request and response schemas.</p>
      <div className="mt-4 divide-y divide-zinc-200">
        {Object.entries(trackingOpenApi.paths).flatMap(([path, methods]) => Object.entries(methods).map(([method, definition]) => <div key={`${method}:${path}`} className="flex flex-wrap items-start gap-x-4 gap-y-1 py-3 text-sm"><span className="w-16 shrink-0 font-semibold text-emerald-800">{method.toUpperCase()}</span><code className="min-w-0 break-all">{path}</code><span className="text-zinc-500">{definition.operationId}</span></div>))}
      </div>
    </section>
    <section className="mt-8 border-t border-zinc-200 pt-6"><h2 className="text-xl font-semibold">Versioning</h2><p className="mt-3">Breaking contract changes use a new major path. Clients should tolerate additional response fields. Webhooks, automatic billing, and self-service organization signup are not included in v1.</p></section>
  </main>;
}
