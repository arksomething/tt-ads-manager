export const DAY = 86_400_000;
export const TEST_GUILD_ID = "1245112089647775877";
export const POLICY_VERSION = "2026-09-07-review";
export const STAGES = {
  warmup: ["Account setup & warmup", "Submit your campaign account links when you are ready."],
  account_review: ["Account review", "Your manager is checking your accounts. We will notify you here."],
  account_ready: ["Account approved", "Your manager will prepare your agreement next."],
  agreement: ["Review your agreement", "Review the terms and complete signing before your trial starts."],
  trial: ["Your seven-day trial", "Post consistently, share your links, and ask for feedback here."],
  active: ["Active creator", "Keep creating. Your posts, feedback, and progress live here."],
  at_risk: ["At Risk", "You have four days from entering At Risk to resume posting or arrange leave."],
  removal_due: ["Test offboarding complete", "The test reached the removal deadline. Staff can reopen your record."],
  removed: ["Offboarded", "Your channel history and earned amounts are retained."],
};

export function text(value, max = 1000) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/gu, " ").trim().slice(0, max) : "";
}
export function markdown(value, max = 1000) {
  return text(value, max).replace(/([\\`*_~|<>])/gu, "\\$1");
}
export function sanitizeChannelName(value) {
  return text(value, 70).normalize("NFKD").replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "") || "creator";
}
export function normalizeMentionUsers(ids) {
  return [...new Set(ids.map(String))].filter(id => /^\d{17,20}$/u.test(id));
}
export function httpsUrl(value) {
  const raw = text(value, 500);
  try { const url = new URL(raw); return url.protocol === "https:" && !url.username && !url.password ? url.href : null; } catch { return null; }
}
export function validateApplication(fields) {
  const value = { name: text(fields.name, 80), phone: text(fields.phone, 30), location: text(fields.location, 100),
    platforms: text(fields.platforms, 400), bestVideo: text(fields.bestVideo, 500) };
  if (value.name.length < 2) return { ok: false, error: "Enter your name." };
  if (!/^[+()\d .-]{7,30}$/u.test(value.phone) || value.phone.replace(/\D/gu, "").length < 7) return { ok: false, error: "Enter a phone number with country code." };
  if (value.location.length < 2) return { ok: false, error: "Enter your location or timezone." };
  if (value.platforms.length < 3) return { ok: false, error: "Enter your platforms and usernames." };
  if (value.bestVideo && !httpsUrl(value.bestVideo)) return { ok: false, error: "Use an https:// video link, or leave best video blank." };
  return { ok: true, value };
}
export function validateTimezone(zone) {
  try { new Intl.DateTimeFormat("en", { timeZone: zone }).format(); return zone; } catch { throw new Error("Use a timezone such as America/New_York, Europe/London, or Asia/Manila."); }
}
export function localDay(at, zone = "UTC") {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at).map(p => [p.type, p.value]));
  return Math.floor(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) / DAY);
}
export function missedDays(creator, now) {
  const baseline = Math.max(Date.parse(creator.last_post_at || creator.trial_started_at || creator.created_at), Date.parse(creator.exception_until || "1970-01-01"));
  return Math.max(0, localDay(now, creator.timezone || "UTC") - localDay(baseline, creator.timezone || "UTC"));
}
export function inactivityDecision({stage, lastPostAt, exceptionUntil = null, riskStartedAt = null, now = Date.now(), testMode = true, timezone = "UTC"}) {
  if (!["trial", "active", "at_risk"].includes(stage) || !lastPostAt) return "none";
  if (exceptionUntil && Date.parse(exceptionUntil) > now) return "excepted";
  if (stage === "at_risk") {
    if (!riskStartedAt) return "none";
    if (now >= Date.parse(riskStartedAt) + 4 * DAY) return testMode ? "would_remove" : "remove";
    return "warning";
  }
  const missed = missedDays({ last_post_at: lastPostAt, timezone, exception_until: exceptionUntil }, now);
  return missed >= 3 ? "at_risk" : missed >= 1 ? "reminder" : "none";
}
export function reminderCopy(creator, now) {
  if (creator.stage === "at_risk") {
    const deadline = Math.floor((Date.parse(creator.risk_started_at) + 4 * DAY) / 1000);
    return { title: "Let’s get you back on track", description: `We have not recorded a new post. Resume posting or arrange leave with your manager before <t:${deadline}:F>. Otherwise, your membership will be removed at the end of your four-day At Risk period.`, color: 0xed8b40 };
  }
  return { title: "Your daily posting check-in", description: `A quick reminder to share today’s post. If you have already posted, submit the link below so we can record it. Need time away? Let your manager know with **Request leave**.\n\n${missedDays(creator, now)} posting day(s) without a recorded post.`, color: 0x8094b8 };
}
export function payoutForViews(views) {
  if (!Number.isInteger(views) || views < 0) return 0;
  return views >= 1_000_000 ? 300 : views >= 300_000 ? 100 : views >= 100_000 ? 50 : views >= 50_000 ? 20 : 0;
}
export function evaluateVideo({ plug, mention, yap, partner, views }) {
  const missing = [];
  if (!plug) missing.push("GoTall plug in the video");
  if (!mention) missing.push("@GoTall in the description");
  if (!yap) missing.push("#yap");
  // Partner is provisional. It is surfaced for review, never an automatic rejection.
  return { eligible: missing.length === 0, missing, payout: missing.length ? 0 : payoutForViews(views),
    policyNotes: partner ? [] : ["#partner is missing; this policy is under review."], policyVersion: POLICY_VERSION };
}
export function canonicalVideo(value) {
  const url = httpsUrl(value);
  if (!url) throw new Error("Enter a complete https:// video link.");
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) {
    const match = parsed.pathname.match(/\/video\/(\d+)/u);
    if (match) return { key: `tiktok:${match[1]}`, url: `${parsed.origin}${parsed.pathname}` };
  }
  if (host === "instagram.com" || host === "www.instagram.com") {
    const match = parsed.pathname.match(/^\/(?:reel|p)\/([A-Za-z0-9_-]+)/u);
    if (match) return { key: `instagram:${match[1]}`, url: `https://www.instagram.com/reel/${match[1]}/` };
  }
  throw new Error("Use the full TikTok /video/ link or Instagram /reel/ or /p/ link (not a shortened share link).");
}
export function transition(creator, action, { now = Date.now(), testMode = false, value = "", actor = "" } = {}) {
  const at = new Date(now).toISOString();
  const stage = creator.stage;
  const need = (...allowed) => { if (!allowed.includes(stage)) throw new Error(`This action is unavailable during ${STAGES[stage]?.[0] || stage}. Refresh your status.`); };
  let patch = {};
  switch (action) {
    case "submit_accounts": need("warmup"); if (!creator.campaign_accounts || !creator.timezone) throw new Error("Add your account links and timezone first."); patch = {stage:"account_review"}; break;
    case "approve_account": need("account_review"); patch = {stage:"account_ready", account_approved_at:at, account_approved_by:actor}; break;
    case "request_changes": need("account_review", "account_ready"); if (!value) throw new Error("Explain the requested changes."); patch = {stage:"warmup", review_note:value, account_approved_at:null}; break;
    case "send_agreement": need("account_ready"); if (!creator.agreement_url && !testMode) throw new Error("Attach the creator’s signing link first."); patch = {stage:"agreement"}; break;
    case "test_signed": need("agreement"); if (!testMode) throw new Error("Signature simulation is available only in the test server."); patch = {stage:"trial", agreement_signed_at:at, agreement_source:"test_simulation", trial_started_at:at, trial_ends_at:new Date(now+7*DAY).toISOString(), last_post_at:at, risk_started_at:null}; break;
    case "pass_trial": need("trial"); if (Date.parse(creator.trial_ends_at) > now) throw new Error("The seven-day trial has not ended yet."); patch = {stage:"active", trial_completed_at:at}; break;
    case "extend_trial": need("trial"); patch = {trial_ends_at:new Date(Math.max(now,Date.parse(creator.trial_ends_at))+3*DAY).toISOString()}; break;
    case "post": need("trial", "active", "at_risk"); patch = {stage:stage === "at_risk" ? creator.resume_stage || "active" : stage, last_post_at:at, risk_started_at:null, last_warning_at:null}; break;
    case "risk": need("trial", "active"); patch = {stage:"at_risk", resume_stage:stage, risk_started_at:at, last_warning_at:null}; break;
    case "offboard": need("at_risk"); if (!testMode) throw new Error("Live removal is disabled until tracking and signing are integrated."); patch = {stage:"removal_due", removed_at:at}; break;
    case "reopen": need("removal_due", "removed"); patch = {stage:"warmup", removed_at:null, risk_started_at:null, trial_started_at:null, trial_ends_at:null, trial_completed_at:null, agreement_signed_at:null, agreement_source:null, account_approved_at:null, last_post_at:null, exception_until:null, notice_pending:0}; break;
    default: throw new Error("Unknown action.");
  }
  return {...patch, updated_at:at};
}

export const button = (id, label, style = 2) => ({type:2,custom_id:`gt:${id}`,label,style});
export const row = (...buttons) => ({type:1,components:buttons});
export function card(title, description, color = 0x8b9c87, fields = []) {
  return {content:"", embeds:[{author:{name:"GoTall · Creator workspace"},title,description,color,fields,
    footer:{text:"Your channel. Your progress. Your team."}}], components:[], allowed_mentions:{parse:[]}};
}
export function startCard() {
  return {...card("Your next chapter starts here", "Create with GoTall, with your team one message away.\n\n**01 · Introduce yourself**\nA short form. Best video is optional.\n\n**02 · Make it yours**\nGet a private channel for account setup, feedback, and support.\n\n**03 · Start creating**\nAccount review → agreement → seven-day trial."),
    components:[row(button("apply","Start onboarding",1),button("resume","Open my workspace")),row(button("guide","How it works"))]};
}
export function statusCard(c, testMode = true) {
  const [title, description] = STAGES[c.stage] || ["Review needed","Your manager is checking this record."];
  const live = ["trial","active","at_risk"].includes(c.stage);
  const fields = [{name:"Creator",value:markdown(c.name),inline:true},{name:"Timezone",value:c.timezone || "Confirm during account setup",inline:true}];
  if (c.campaign_accounts) fields.push({name:"Campaign accounts",value:markdown(c.campaign_accounts,500)});
  if (c.review_note && c.stage === "warmup") fields.push({name:"From your manager",value:markdown(c.review_note,500)});
  if (c.trial_ends_at && !c.trial_completed_at) fields.push({name:"Trial review",value:`<t:${Math.floor(Date.parse(c.trial_ends_at)/1000)}:F>`});
  if (c.risk_started_at && c.stage === "at_risk") fields.push({name:"At Risk deadline",value:`<t:${Math.floor((Date.parse(c.risk_started_at)+4*DAY)/1000)}:F>`});
  if (c.notice_pending) fields.push({name:"Leave request",value:"Your manager has been notified. Inactivity enforcement is paused while it is reviewed."});
  if (c.exception_until) fields.push({name:"Approved leave through",value:`<t:${Math.floor(Date.parse(c.exception_until)/1000)}:F>`});
  const actions = [];
  if (c.stage === "warmup") actions.push(button("accounts","Add account links",1),button("ready","Ready for review",3));
  if (c.stage === "agreement") {
    if (c.agreement_url) actions.push({type:2,style:5,label:"Review & sign",url:c.agreement_url});
    if (testMode) actions.push(button("test_signed","Simulate signature",1));
  }
  if (live) actions.push(button("post","Submit a post",1),button("leave","Request leave"));
  return {...card(title, description, c.stage === "at_risk" ? 0xed8b40 : 0x8b9c87,fields),
    components:[...(actions.length?[row(...actions)]:[]),row(button("guide","Creator guide"),button("help","Get help"),button("staff","Staff controls"))]};
}
export function guideCard() {
  return card("The creator guide", "**Account setup**\nUse a complete profile, secure your account, and follow your manager’s approved warmup instructions. Submit the campaign account links for review.\n\n**Getting started**\nYour trial starts after signing. Your manager reviews your first seven days and can pass or extend the trial.\n\n**Posting**\nSubmit each post in your private channel. If you need time away, request leave before missing a day. Days 1–3 get friendly reminders; three missed days without notice starts a four-day At Risk period with daily warnings.\n\n**Content checks**\nInclude the GoTall plug, @GoTall, and #yap. Use **#partner** as the provisional spelling; that policy is still under review.\n\n**Milestone estimates**\n50K → $20 · 100K → $50 · 300K → $100 · 1M → $300\nEach video uses its highest reached tier. Estimates remain separate from approved or paid amounts. The eligible view window is still awaiting policy approval.");
}
export function staffCard(c, testMode) {
  const actions = [];
  if(c.stage === "account_review") actions.push(button("approve_account","Approve account",3),button("changes","Request changes"));
  if(c.stage === "account_ready") actions.push(button("agreement_link","Attach signing link"),button("send_agreement","Send agreement",1));
  if(c.stage === "trial") actions.push(button("pass_trial","Pass trial",3),button("extend_trial","Extend by 3 days"));
  if(["trial","active","at_risk"].includes(c.stage)) actions.push(button("exception","Approve leave"));
  if(["removed","removal_due"].includes(c.stage)) actions.push(button("reopen","Reopen onboarding"));
  const components = actions.length ? [row(...actions)] : [];
  components.push(row(button("review_posts","Review posts"),button("profile","Application details")));
  if(testMode) components.push(row(button("test_clock","Test timeline")));
  return {...card("Staff workspace",`**${markdown(c.name)}** · ${STAGES[c.stage]?.[0]}\nChoose the next action below. Every approval is recorded with your Discord identity.`),components};
}
