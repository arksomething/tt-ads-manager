const EDGE_PATH_SUFFIX = "/functions/v1/creator-tracker-monitor-tick";
const RESEND_URL = "https://api.resend.com/emails";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

class MonitorRuntimeError extends Error {
  constructor(code, status = 500) {
    super(code);
    this.name = "MonitorRuntimeError";
    this.code = code;
    this.status = status;
  }
}

function json(status, value) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, max-age=0",
    },
  });
}

function required(environment, name, minimumLength = 1) {
  const value = environment[name]?.trim();
  if (!value || value.length < minimumLength) {
    throw new MonitorRuntimeError("MONITOR_NOT_CONFIGURED", 503);
  }
  return value;
}

function runtimeConfig(environment) {
  const supabaseUrl = required(environment, "SUPABASE_URL");
  let parsedUrl;
  try {
    parsedUrl = new URL(supabaseUrl);
  } catch {
    throw new MonitorRuntimeError("MONITOR_NOT_CONFIGURED", 503);
  }
  if (
    parsedUrl.protocol !== "https:" ||
    parsedUrl.username ||
    parsedUrl.password ||
    parsedUrl.pathname !== "/" ||
    parsedUrl.search ||
    parsedUrl.hash
  ) {
    throw new MonitorRuntimeError("MONITOR_NOT_CONFIGURED", 503);
  }

  const to = required(environment, "CREATOR_TRACKER_MONITOR_EMAIL_TO")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const emailPattern = /^[^\s<>@,]+@[^\s<>@,]+\.[^\s<>@,]+$/;
  if (to.length < 1 || to.length > 5 || to.some((value) => !emailPattern.test(value))) {
    throw new MonitorRuntimeError("MONITOR_NOT_CONFIGURED", 503);
  }

  const from = required(environment, "CREATOR_TRACKER_MONITOR_EMAIL_FROM");
  if (from.length > 320 || /[\r\n]/.test(from) || !from.includes("@")) {
    throw new MonitorRuntimeError("MONITOR_NOT_CONFIGURED", 503);
  }

  return {
    supabaseUrl: parsedUrl.origin,
    serviceRoleKey: required(environment, "SUPABASE_SERVICE_ROLE_KEY", 32),
    tickSecret: required(environment, "CREATOR_TRACKER_MONITOR_TICK_SECRET", 32),
    resendApiKey: required(environment, "RESEND_API_KEY", 20),
    emailFrom: from,
    emailTo: to,
  };
}

async function sha256Hex(cryptoImpl, value) {
  const bytes = new TextEncoder().encode(value);
  const digest = new Uint8Array(await cryptoImpl.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function secretsEqual(cryptoImpl, supplied, expected) {
  const [left, right] = await Promise.all([
    sha256Hex(cryptoImpl, supplied),
    sha256Hex(cryptoImpl, expected),
  ]);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function validateTickRequestTarget(request) {
  const url = new URL(request.url);
  return (
    request.method === "POST" &&
    (url.pathname === "/creator-tracker-monitor-tick" ||
      url.pathname.endsWith(EDGE_PATH_SUFFIX)) &&
    url.search === ""
  );
}

async function rpc(fetchImpl, config, name, body) {
  const response = await fetchImpl(`${config.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: config.serviceRoleKey,
      authorization: `Bearer ${config.serviceRoleKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new MonitorRuntimeError("MONITOR_DATABASE_UNAVAILABLE", 503);
  }
  try {
    return await response.json();
  } catch {
    throw new MonitorRuntimeError("MONITOR_DATABASE_RESPONSE_INVALID", 503);
  }
}

function isDelivery(value) {
  return (
    value &&
    typeof value === "object" &&
    UUID.test(value.delivery_id ?? "") &&
    UUID.test(value.lease_token ?? "") &&
    ["opened", "repeat", "recovered"].includes(value.event_kind) &&
    value.event_payload &&
    typeof value.event_payload === "object" &&
    !Array.isArray(value.event_payload) &&
    Number.isSafeInteger(value.attempt_number) &&
    value.attempt_number > 0
  );
}

function safeTimestamp(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return "unknown";
  return new Date(value).toISOString();
}

function safeIssueCodes(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === "string" && /^[a-z0-9][a-z0-9._:-]{0,63}$/.test(item))
    .slice(0, 32);
}

function htmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderMonitorEmail(eventKind, payload) {
  const monitorId =
    typeof payload.monitorId === "string" ? payload.monitorId : "creator tracker";
  const outageStartedAt = safeTimestamp(payload.outageStartedAt);
  const lastReceivedAt = safeTimestamp(payload.lastReceivedAt);
  const recoveredAt = safeTimestamp(payload.recoveredAt);
  const issues = safeIssueCodes(payload.issueCodes);
  const runtimeFailure = payload.incidentKind === "runtime_failing";

  let subject;
  let headline;
  let summary;
  if (eventKind === "recovered") {
    subject = runtimeFailure
      ? `[Recovered] Creator tracker runtime restored`
      : `[Recovered] Creator tracker heartbeat restored`;
    headline = runtimeFailure
      ? "Creator tracker runtime restored"
      : "Creator tracker heartbeat restored";
    summary = runtimeFailure
      ? `The tracker reported a non-failing runtime state at ${recoveredAt}.`
      : `The off-host monitor received a new heartbeat at ${recoveredAt}.`;
  } else if (eventKind === "repeat") {
    subject = runtimeFailure
      ? `[Still failing] Creator tracker runtime failure`
      : `[Still down] Creator tracker heartbeat missing`;
    headline = runtimeFailure
      ? "Creator tracker is still reporting failure"
      : "Creator tracker is still not checking in";
    summary = runtimeFailure
      ? `The laptop is checking in, but the tracker runtime remains in a failing state.`
      : `No heartbeat has reached the off-host monitor since ${lastReceivedAt}.`;
  } else {
    subject = runtimeFailure
      ? `[Urgent] Creator tracker runtime failure`
      : `[Urgent] Creator tracker heartbeat missing`;
    headline = runtimeFailure
      ? "Creator tracker reported a runtime failure"
      : "Creator tracker stopped checking in";
    summary = runtimeFailure
      ? `The laptop is checking in, but the tracker reports that its data path is failing.`
      : `No heartbeat has reached the off-host monitor since ${lastReceivedAt}.`;
  }

  const details = [
    `Monitor: ${monitorId}`,
    `Outage threshold crossed: ${outageStartedAt}`,
    eventKind === "recovered" ? `Recovered: ${recoveredAt}` : `Last heartbeat: ${lastReceivedAt}`,
    `Last reported state: ${typeof payload.lastStatus === "string" ? payload.lastStatus : "unknown"}`,
    `Last issue codes: ${issues.length ? issues.join(", ") : "none reported"}`,
  ];
  const caution = runtimeFailure
    ? "This is a live tracker failure. Check the issue codes, repair the data path, and backfill the affected window."
    : "This alert detects loss of monitoring. It does not prove whether creator data was missed; check the tracker and backfill any affected window.";
  const text = `${headline}\n\n${summary}\n\n${details.join("\n")}\n\n${caution}`;
  const html = [
    `<h1>${htmlEscape(headline)}</h1>`,
    `<p>${htmlEscape(summary)}</p>`,
    `<ul>${details.map((detail) => `<li>${htmlEscape(detail)}</li>`).join("")}</ul>`,
    `<p><strong>${htmlEscape(caution)}</strong></p>`,
  ].join("");
  return { subject, text, html };
}

function retryDelaySeconds(attemptNumber) {
  const delays = [60, 120, 300, 600, 1800];
  return delays[Math.min(Math.max(attemptNumber - 1, 0), delays.length - 1)];
}

function resendErrorCode(status) {
  if (status === 429) return "resend_rate_limited";
  if (status === 401 || status === 403) return "resend_authentication_failed";
  if (status >= 500) return "resend_unavailable";
  return "resend_request_rejected";
}

async function complete(fetchImpl, config, delivery, result) {
  const response = await rpc(
    fetchImpl,
    config,
    "complete_creator_tracker_monitor_delivery",
    {
      target_delivery_id: delivery.delivery_id,
      target_lease_token: delivery.lease_token,
      result_input: result,
    },
  );
  if (!response || response.accepted !== true) {
    throw new MonitorRuntimeError("MONITOR_DELIVERY_COMPLETION_REJECTED", 503);
  }
}

async function deliverEmail(fetchImpl, cryptoImpl, config, delivery) {
  const content = renderMonitorEmail(delivery.event_kind, delivery.event_payload);
  let response;
  try {
    response = await fetchImpl(RESEND_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.resendApiKey}`,
        "content-type": "application/json",
        "idempotency-key": `creator-tracker-monitor/${delivery.delivery_id}`,
      },
      body: JSON.stringify({
        from: config.emailFrom,
        to: config.emailTo,
        subject: content.subject,
        text: content.text,
        html: content.html,
      }),
    });
  } catch {
    await complete(fetchImpl, config, delivery, {
      outcome: "retry",
      providerStatus: null,
      providerReceiptSha256: null,
      errorCode: "resend_network_error",
      retryAfterSeconds: retryDelaySeconds(delivery.attempt_number),
    });
    return { sent: false, code: "resend_network_error" };
  }

  const responseText = await response.text();
  if (response.ok) {
    let providerMessageId;
    try {
      const parsed = JSON.parse(responseText);
      providerMessageId = parsed?.id;
    } catch {
      providerMessageId = null;
    }
    if (
      typeof providerMessageId !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(providerMessageId)
    ) {
      await complete(fetchImpl, config, delivery, {
        outcome: "retry",
        providerStatus: response.status,
        providerMessageId: null,
        providerReceiptSha256: null,
        errorCode: "resend_response_invalid",
        retryAfterSeconds: retryDelaySeconds(delivery.attempt_number),
      });
      return { sent: false, code: "resend_response_invalid" };
    }
    await complete(fetchImpl, config, delivery, {
      outcome: "sent",
      providerStatus: response.status,
      providerMessageId,
      providerReceiptSha256: await sha256Hex(cryptoImpl, responseText),
      errorCode: null,
      retryAfterSeconds: null,
    });
    return { sent: true };
  }

  const code = resendErrorCode(response.status);
  await complete(fetchImpl, config, delivery, {
    outcome: "retry",
      providerStatus: response.status,
      providerMessageId: null,
    providerReceiptSha256: null,
    errorCode: code,
    retryAfterSeconds: retryDelaySeconds(delivery.attempt_number),
  });
  return { sent: false, code };
}

export function createMonitorTickHandler({
  environment,
  fetchImpl = fetch,
  cryptoImpl = crypto,
}) {
  return async function handleMonitorTick(request) {
    try {
      if (!validateTickRequestTarget(request)) {
        return json(404, { ok: false, error: { code: "NOT_FOUND" } });
      }
      const config = runtimeConfig(environment);
      const suppliedSecret = request.headers.get("x-gotall-monitor-tick-secret") ?? "";
      if (!await secretsEqual(cryptoImpl, suppliedSecret, config.tickSecret)) {
        return json(401, { ok: false, error: { code: "AUTHENTICATION_FAILED" } });
      }
      const contentType = request.headers.get("content-type") ?? "";
      if (contentType.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
        return json(415, { ok: false, error: { code: "UNSUPPORTED_MEDIA_TYPE" } });
      }
      const rawBody = await request.text();
      if (new TextEncoder().encode(rawBody).byteLength > 1024) {
        return json(413, { ok: false, error: { code: "PAYLOAD_TOO_LARGE" } });
      }
      let body;
      try {
        body = JSON.parse(rawBody);
      } catch {
        return json(400, { ok: false, error: { code: "INVALID_JSON" } });
      }
      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        body.schemaVersion !== 1 ||
        Object.keys(body).length !== 1
      ) {
        return json(422, { ok: false, error: { code: "INVALID_TICK" } });
      }

      const leased = await rpc(
        fetchImpl,
        config,
        "lease_creator_tracker_monitor_deliveries",
        { worker_id: "supabase-edge-monitor", max_deliveries: 10, lease_seconds: 120 },
      );
      if (!Array.isArray(leased) || leased.some((delivery) => !isDelivery(delivery))) {
        throw new MonitorRuntimeError("MONITOR_DATABASE_RESPONSE_INVALID", 503);
      }

      const results = [];
      for (const delivery of leased) {
        results.push(await deliverEmail(fetchImpl, cryptoImpl, config, delivery));
      }
      return json(200, {
        ok: true,
        leased: leased.length,
        sent: results.filter((result) => result.sent).length,
        retrying: results.filter((result) => !result.sent).length,
      });
    } catch (error) {
      const known = error instanceof MonitorRuntimeError;
      return json(known ? error.status : 500, {
        ok: false,
        error: { code: known ? error.code : "MONITOR_TICK_FAILED" },
      });
    }
  };
}
