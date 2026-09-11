import { AGREEMENT_URL, messageCopy } from "./messages.mjs";
export const DAY = 86_400_000;
export const TEST_GUILD_ID = "1245112089647775877";
export const POLICY_VERSION = "2026-09-10-blazie-draft";
export const STAGES = {
  warmup: ["Set up your accounts · your turn", "1. Complete your profiles and the team’s warmup instructions. If you haven’t received those instructions, ask in this channel.\n2. Choose **Add account links** to submit your TikTok and Instagram profiles for review."],
  account_review: ["Accounts sent for review", "The team will check your accounts and get back to you here. Hold off on posting until your accounts are approved and your agreement is signed."],
  account_ready: ["Accounts approved · waiting for the team", "The team will attach your signing link and send your creator agreement here. You don’t need to submit your accounts again. Wait until signing is complete before starting campaign posts."],
  agreement: ["Your creator agreement", "Read through the agreement before signing. If anything is unclear, ask us here. Your seven-day trial starts after signing."],
  trial: ["Seven-day trial · post and submit daily", "Publish your campaign video, then choose **Submitted post** to send its link. Posting on TikTok or Instagram alone does not update this tracker.\n\nAfter the trial ends, staff review your posts and either approve you to continue or extend the trial by three days. Approval is not automatic."],
  active: ["You’re an active creator", "Continue posting daily and send each video link with **Submitted post** so it appears in the team’s review list. Ask for feedback in this channel. If you need a break, use **Request time off** before you miss a day."],
  at_risk: ["Action needed · posting links are missing", "The tracker reached three missed posting days without pending or approved leave. If you already published, submit the video link below. Otherwise, request time off before the deadline.\n\nSubmitting a new post clears this warning and returns you to your previous trial or active stage. A time-off request pauses the countdown while staff review it."],
  removal_due: ["Posting deadline passed", "The four-day deadline has passed. Contact the team here to discuss your next steps."],
  removed: ["You’re no longer active", "Contact the team here if you’d like to return to the program."],
};

Object.assign(STAGES, {
  warmup: ['Step 1 · Create your accounts', messageCopy(2)],
  account_review: ['Step 2 · Account verification', messageCopy(3)],
  account_ready: ['Step 3 · Warm up your account', messageCopy(4)],
  warmup_review: ['Warm-up completion received', messageCopy(5)],
  agreement_ready: ['Warm-up approved', 'The team can now send your creator agreement. Please wait before filming or posting.'],
  agreement: ['Step 4 · Creator agreement', messageCopy(6)],
  agreement_review: ['Signature confirmation pending', 'Your signing confirmation has been received. Staff must verify the completed Jotform agreement, including a parent or guardian signature when required. Please wait before filming or posting.'],
  first_video: ['Step 5 · Your first video', messageCopy(7)],
  first_video_review: ['First video received', messageCopy(8)],
  hub_ready: ['First video approved', messageCopy(9)],
});
export const MESSAGE_STAGES = {warmup:2, account_review:3, account_ready:4, warmup_review:5, agreement:6, first_video:7, first_video_review:8, hub_ready:9};

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
  if (!value.name) return { ok: false, error: "Tell us what to call you. A preferred name or nickname is fine." };
  if (!/^[+()\d .-]{7,30}$/u.test(value.phone) || value.phone.replace(/\D/gu, "").length < 7) return { ok: false, error: "Enter a phone number with country code." };
  if (value.location.length < 2) return { ok: false, error: "Enter your location or timezone." };
  if (value.platforms.length < 3) return { ok: false, error: "Enter your platforms and usernames." };
  if (value.bestVideo && !httpsUrl(value.bestVideo)) return { ok: false, error: "Use an https:// video link, or leave best video blank." };
  return { ok: true, value };
}
export function validateTimezone(zone) {
  try { new Intl.DateTimeFormat("en", { timeZone: zone }).format(); return zone; } catch { throw new Error("Use a timezone such as America/New_York, Europe/London, or Asia/Manila."); }
}
export function parseAccountFields(instagram, tiktok) {
  const entries=[['Instagram',instagram],['TikTok',tiktok]].map(([platform,value])=>{
    const entry=String(value||'').trim();
    if(!entry)throw new Error(`Add your ${platform} handle or profile link in the ${platform} field.`);
    if(/[\r\n]/u.test(entry))throw new Error(`Enter one account in the ${platform} field.`);
    return `${platform}: ${entry}`;
  });
  try { return parseAccountLinks(entries.join('\n')); }
  catch(error) {
    throw new Error(error.message.split('\n\nAdd both')[0]+'\n\nEnter a handle or profile link in each platform’s field. No platform labels are needed. Nothing was saved.');
  }
}
export function parseAccountLinks(value) {
  const fail=(reason,input='')=>{throw new Error(`⚠️ Account details need a quick fix\n${input?`I couldn’t parse “${markdown(input,100)}”.\n`:''}${reason}\n\nAdd both your TikTok and Instagram accounts, for example:\nTikTok: @yourname\nInstagram: @yourname\nFull profile links work too. Nothing was saved; fix the entry and submit again.`);};
  if(typeof value!=='string'||!value.trim())return fail('No account details were entered.');
  if(value.length>500)return fail(`Your entry has ${value.length} characters; the limit is 500.`);
  let rest=value.trim().replace(/\r/g,'').replace(/[：]/gu,':').replace(/[–—]/gu,'-')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gu,'$2')
    .replace(/^[ \t]*(?:[-*•]|\d+[.)])[ \t]+/gmu,'')
    .replace(/@[ \t]+/gu,'@');const links=[],platforms=new Set();
  while(rest) {
    rest=rest.replace(/^[\s,;|]+/u,'');if(!rest)break;
    const label=rest.match(/^(tik\s*tok|tt|instagram|insta|ig)(?:\s+(?:accounts?|handles?|usernames?|profiles?|links?))?(?:\s*[:=\-]\s*|\s+|(?=@))/iu);
    const platform=label?(/^(tik\s*tok|tt)$/iu.test(label[1])?'tiktok':'instagram'):null;
    if(label)rest=rest.slice(label[0].length);
    const rawToken=rest.match(/^[^\s,;|]+/u)?.[0];if(!rawToken)return fail(`The ${platform} label is missing its handle or profile link.`);
    rest=rest.slice(rawToken.length);
    const token=rawToken.replace(/^[<(["'`]+/gu,'').replace(/[>)\]"'`]+$/gu,'');
    let host,handle;
    if(/^(?:https?:\/\/)?(?:(?:www|m)\.)?(?:tiktok|instagram)\.com\//iu.test(token)) {
      let u;try {u=new URL(/^https?:/iu.test(token)?token:'https://'+token);}catch{return fail('This profile URL is malformed.',token);}
      host=u.hostname.toLowerCase().replace(/^(www|m)\./u,'').replace(/\.com$/u,'');
      if(!['tiktok','instagram'].includes(host)||u.username||u.password||u.port)return fail('Use a direct tiktok.com or instagram.com profile URL without login details or a custom port.',token);
      const match=u.pathname.match(/^\/@?([\w.]+)\/?$/u);
      if(!match)return fail(`This is not a ${host} profile URL. Open the account profile and copy its link, rather than a video or reel link.`,token);handle=match[1];
      if(platform&&platform!==host)return fail(`The label says ${platform}, but this URL belongs to ${host}. Correct the label or link.`,token);
    } else {
      if(!platform)return fail(/youtube|youtu\.be/iu.test(token)?'YouTube is not supported for campaign accounts.':'This entry has no recognized platform label. Use TikTok/TT or Instagram/IG before a handle.',token);host=platform;handle=token.replace(/^@/u,'').replace(/\/$/u,'');
    }
    if(!/^[A-Za-z0-9_.]+$/u.test(handle))return fail(`The ${host} handle contains unsupported characters. Use letters, numbers, underscores or periods, with an optional @ at the start.`,token);
    if(host==='instagram'&&['reel','reels','p','stories','explore','accounts'].includes(handle.toLowerCase()))return fail('This Instagram link points to a site section, not an account profile.',token);
    platforms.add(host);
    links.push(host==='tiktok'?`https://www.tiktok.com/@${handle.toLowerCase()}`:`https://www.instagram.com/${handle.toLowerCase()}/`);
  }
  if(platforms.size!==2)return fail(`I recognized ${platforms.has('tiktok')?'TikTok':'Instagram'}, but the ${platforms.has('tiktok')?'Instagram':'TikTok'} account is missing.`);
  return [...new Set(links)].join('\n');
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
    return { title: "Action needed · submit a link or request time off", description: `The tracker still needs a new post link. Submit one or use **Request time off** by **<t:${deadline}:F>**. A time-off request pauses checks while staff review it; a chat message alone does not.\n\nAn expired deadline sends your account to the team for review.`, color: 0xed8b40 };
  }
  const days = missedDays(creator, now);
  return { title: "Have you posted today?", description: `We haven’t received a post from you in ${days} ${days === 1 ? "day" : "days"}. If you’ve already posted, use **Submitted post** on your status card to send the link.\n\nNeed a break? Use **Request time off** and let us know when you’ll be back.`, color: 0x8094b8 };
}
export function payoutForViews(views) {
  if (!Number.isInteger(views) || views < 0) return 0;
  return views >= 2_000_000 ? 1000 : views >= 1_000_000 ? 500 : views >= 700_000 ? 350 : views >= 500_000 ? 250 : views >= 300_000 ? 100 : views >= 100_000 ? 50 : views >= 50_000 ? 20 : 0;
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
  if (['youtube.com','www.youtube.com','youtu.be'].includes(host)) {
    const id = host === 'youtu.be' ? parsed.pathname.slice(1) : parsed.pathname.startsWith('/shorts/') ? parsed.pathname.split('/')[2] : parsed.searchParams.get('v');
    if (/^[A-Za-z0-9_-]{11}$/u.test(id || '')) return {key:`youtube:${id}`,url:`https://www.youtube.com/watch?v=${id}`};
  }
  throw new Error("Use a full TikTok, Instagram, or YouTube video link.");
}
export function transition(creator, action, { now = Date.now(), testMode = false, value = "", actor = "" } = {}) {
  const at = new Date(now).toISOString();
  const stage = creator.stage;
  const need = (...allowed) => { if (!allowed.includes(stage)) throw new Error(`This action is unavailable during ${STAGES[stage]?.[0] || stage}. Refresh your status.`); };
  let patch = {};
  switch (action) {
    case "submit_accounts": need("warmup"); if (!creator.campaign_accounts || !creator.timezone) throw new Error("Add your account links and timezone first."); patch = {stage:"account_review"}; break;
    case "approve_account": need("account_review"); patch = {stage:"account_ready", account_approved_at:at, account_approved_by:actor}; break;
    case "request_changes": need("account_review", "account_ready", "warmup_review", "agreement_ready"); if (!value) throw new Error("Explain the requested changes."); patch = {stage:"warmup", review_note:value, account_approved_at:null}; break;
    case "complete_warmup": need("account_ready"); patch = {stage:"warmup_review"}; break;
    case "approve_warmup": need("warmup_review"); if (!creator.account_approved_at) throw new Error("Account approval must be recorded before approving warm-up."); if (!httpsUrl(creator.agreement_url || AGREEMENT_URL)) throw new Error("Attach a valid HTTPS agreement link before approving warm-up."); patch = {stage:"agreement", warmup_approved_at:at, agreement_url:creator.agreement_url || AGREEMENT_URL}; break;
    case "send_agreement": need("agreement_ready"); if (!creator.account_approved_at) throw new Error("Account approval must be recorded first. Submit accounts for review."); if (!creator.warmup_approved_at) throw new Error("Warm-up approval is required."); patch = {stage:"agreement", agreement_url:creator.agreement_url || AGREEMENT_URL}; break;
    case "signed": need("agreement"); patch = {stage:"agreement_review"}; break;
    case "confirm_signature": need("agreement_review"); if (!value) throw new Error("Record the verified Jotform submission reference and any required guardian signature check."); patch = {stage:"first_video", agreement_signed_at:at, agreement_source:"staff_verified_jotform", signature_evidence:value}; break;
    case "test_signed": need("agreement"); if (!testMode) throw new Error("Signature simulation is available only in the test server."); if (!creator.account_approved_at || !creator.warmup_approved_at) throw new Error("Account and warm-up approval must be recorded before signing."); patch = {stage:"first_video", agreement_signed_at:at, agreement_source:"test_simulation"}; break;
    case "submit_first_video": need("first_video"); if (!httpsUrl(value)) throw new Error("Send an https link to your first video draft."); patch = {stage:"first_video_review", first_video_url:value}; break;
    case "revise_first_video": need("first_video_review"); if (!value) throw new Error("Explain the requested video changes."); patch = {stage:"first_video", first_video_note:value}; break;
    case "approve_first_video": need("first_video_review"); if (!creator.agreement_signed_at || !creator.first_video_url) throw new Error("A verified agreement and submitted draft are required."); patch = {stage:"hub_ready", first_video_approved_at:at}; break;
    case "open_hub": need("hub_ready"); if (!creator.first_video_approved_at || !creator.agreement_signed_at) throw new Error("First video and agreement approval are required."); patch = {stage:"trial", trial_started_at:at, trial_ends_at:new Date(now+7*DAY).toISOString(), last_post_at:at, risk_started_at:null}; break;
    case "pass_trial": need("trial"); if (!creator.agreement_signed_at || !Number.isFinite(Date.parse(creator.trial_ends_at))) throw new Error("A signed agreement and trial end date are required."); if (Date.parse(creator.trial_ends_at) > now) throw new Error("The seven-day trial has not ended yet."); patch = {stage:"active", trial_completed_at:at}; break;
    case "extend_trial": need("trial"); if (!Number.isFinite(Date.parse(creator.trial_ends_at))) throw new Error("A trial end date is required."); patch = {trial_ends_at:new Date(Math.max(now,Date.parse(creator.trial_ends_at))+3*DAY).toISOString()}; break;
    case "post": need("hub_ready", "trial", "active", "at_risk"); if(stage==='hub_ready'&&(!creator.first_video_approved_at||!creator.agreement_signed_at))throw new Error('Your draft and agreement must be approved before submitting a published post.'); patch = {stage:stage === "at_risk" ? creator.resume_stage || "active" : stage, last_post_at:at, risk_started_at:null, last_warning_at:null}; break;
    case "risk": need("trial", "active"); patch = {stage:"at_risk", resume_stage:stage, risk_started_at:at, last_warning_at:null}; break;
    case "offboard": need("at_risk"); if (!testMode) throw new Error("Live removal is disabled until tracking and signing are integrated."); if (!creator.risk_started_at || now < Date.parse(creator.risk_started_at)+4*DAY || creator.notice_pending || Date.parse(creator.exception_until)>now) throw new Error("The full At Risk period must expire without pending or approved leave."); patch = {stage:"removal_due", removed_at:at}; break;
    case "reopen": need("removal_due", "removed"); patch = {stage:"warmup", warmup_approved_at:null, first_video_url:null, first_video_note:null, first_video_approved_at:null, signature_evidence:null, removed_at:null, risk_started_at:null, trial_started_at:null, trial_ends_at:null, trial_completed_at:null, agreement_signed_at:null, agreement_source:null, account_approved_at:null, last_post_at:null, exception_until:null, notice_pending:0}; break;
    default: throw new Error("Unknown action.");
  }
  return {...patch, updated_at:at};
}

export const button = (id, label, style = 2) => ({type:2,custom_id:`gt:${id}`,label,style});
export const row = (...buttons) => ({type:1,components:buttons});
export function modalValues(interaction) {
  return Object.fromEntries((interaction.data?.components ?? []).flatMap(r=>r.component?[r.component]:r.components??[])
    .filter(c=>typeof c.custom_id==='string').map(c=>[c.custom_id,c.value]));
}
export function formInput(customId,label,placeholder,maxLength,style=1,required=true,description='') {
  return {type:18,label,...(description?{description}:{}),component:{type:4,custom_id:customId,placeholder,style,required,max_length:maxLength}};
}
const timestamp = value => `<t:${Math.floor(Date.parse(value)/1000)}:F>`;
export function accountLinks(value) {
  return text(value,500).split(/\s+/u).filter(Boolean).map((v,i)=>{
    const url=httpsUrl(v);
    if(!url)return markdown(v);
    const parsed=new URL(url),host=parsed.hostname.replace(/^(www|m)\./u,'');
    const platform={'tiktok.com':'TikTok','instagram.com':'Instagram'}[host];
    const handle=parsed.pathname.match(/^\/@?([\w.]+)\/?$/u)?.[1];
    const label=platform&&handle?`${platform} · @${markdown(handle)}`:`Account ${i+1}`;
    return `[${label}](<${url.replace(/\(/g,'%28').replace(/\)/g,'%29')}>)`;
  }).join('\n');
}
export function card(title, description, color = 0x8b9c87, fields = []) {
  return {content:"", embeds:[{author:{name:"GoTall Creators"},title,description,color,fields,
    footer:{text:"GoTall creators"}}], components:[], allowed_mentions:{parse:[]}};
}
export function startCard() {
  return {...card("👋 Welcome to the GoTall Creator Program", "You’re officially inside! Before you can start creating, we need to get a few things set up.\n\n**👇 Your next step**\nChoose Start onboarding below to fill out your form.\n\n**You’ll be asked for**\n• What we should call you\n• Your country\n• Your phone number\n• Your TikTok and Instagram information\n• Your best previous video *(optional)*\n\n**🔐 What happens next?**\nOnce you complete the form, we’ll automatically create your private onboarding channel inside the server. That’s where you’ll work directly with the team while getting set up.\n\n✅ Please complete this before doing anything else."),
    components:[row(button("apply","Start onboarding",1),button("resume","My channel")),row(button("guide","How it works"))]};
}
export function statusCard(c, testMode = true, resources = {}) {
  if(c.has_published && ['hub_ready','trial','active','at_risk'].includes(c.stage)) {
    const link=(key,label)=>resources[`channel_${key}`]?`<#${resources[`channel_${key}`]}> — ${label}`:label;
    return {...card('📌 Your creator directory',`Everything you need for your next video is here.\n\n**📚 Creator Hub**\n• ${link('app_access','Get the app for free')}\n• ${link('assets','Logos and creative assets')}\n• ${link('winning_formats','Winning formats')}\n• ${link('script_library','Scripts and concepts')}\n• ${link('creator_community','Community and support')}\n\n**🎬 Keep creating**\nGet approval before publishing, then report both TikTok and Instagram links with **Submitted post**.\n\n**📋 Policies & support**\nUse **Creator commands** for time off, account controls and leaving the program. Use **Full creator guide** for requirements. Ask your managers here for help.\n\n**💸 Payments**\nOpen **Payment hub** to manage your method, check monthly payment information and contact your managers.`,0x8b9c87,[{name:'Your accounts',value:accountLinks(c.campaign_accounts)||'Ask your manager to update your accounts.'},...(c.trial_ends_at?[{name:'Trial ends',value:timestamp(c.trial_ends_at)}]:[]),...(c.notice_pending?[{name:'Time off',value:'Your request is with the managers. Posting checks are paused.'}]:[]),...(c.stage==='at_risk'?[{name:'Action needed',value:'Posting links are missing. Submit your posts or request time off.'}]:[])]),components:[row(button('post','Submitted post',1),button('payments','Payment hub'),...(['trial','active','at_risk'].includes(c.stage)?[button('leave','Request time off')]:[])),row(button('posts','My posts'),button('my_deal','My deal'),button('commands','Creator commands'),button('guide','Full creator guide'),button('staff','Staff controls'))]};
  }
  const [title, defaultDescription] = STAGES[c.stage] || ["Review needed","Your manager is checking this record."];
  let description = MESSAGE_STAGES[c.stage] ? messageCopy(MESSAGE_STAGES[c.stage], c.name) : defaultDescription;
  if(c.stage==='first_video') {
    const channel=(key,fallback)=>resources[`channel_${key}`]?`<#${resources[`channel_${key}`]}>`:fallback;
    description="🎥 You’ve made it to the fun part!\n\n**👇 Explore your Creator Hub**\nYou now have access to the Creator Hub channels. Open them to get ready for your first video:\n"
      +`• ${channel('app_access','#get-the-app')} — free creator app access and download instructions.\n• ${channel('assets','#assets')} — GoTall logos and creative assets.\n• ${channel('winning_formats','#winning-formats')} — find a format you’d like to recreate.\n• ${channel('script_library','#script-library')} — scripts and concepts.\n• ${channel('creator_community','#creator-community')} — questions and support.\n\n`
      +"**1. Choose your format**\nLook through the winning formats and find one you like. Send its link here and tell us: **“I want to make this one.”**\nWe’ll help you plan your version.\n\n**2. Film and submit your draft**\nUse the team’s guidance, then choose **Submit first video** below. We’ll review it and share feedback.\n\n**⏳ Wait for approval before posting**\nYour Hub access lets you prepare. Your trial hasn’t started yet.\n\n🔥 Take formats that are already working and make them your own.";
  }
  const live = ["trial","active","at_risk"].includes(c.stage);
  const fields = [{name:"Creator",value:markdown(c.name),inline:true},{name:"Timezone",value:c.timezone || "Please clarify your city or timezone in Add account links",inline:true}];
  if (c.stage === "agreement_ready" && !c.account_approved_at) fields.push({name:"One more step",value:"The team needs to review your account links before sending your agreement."});
  if (c.campaign_accounts) fields.push({name:"Your accounts",value:accountLinks(c.campaign_accounts)});
  if (c.review_note && c.stage === "warmup") fields.push({name:"A note from the team",value:markdown(c.review_note,500)});
  if (c.trial_ends_at && !c.trial_completed_at) fields.unshift({name:"Staff can review the trial after",value:timestamp(c.trial_ends_at)+"\nDiscord displays this date in your local time. Posting days use the timezone saved below."});
  if (c.risk_started_at && c.stage === "at_risk") fields.push({name:"Post or check in by",value:`<t:${Math.floor((Date.parse(c.risk_started_at)+4*DAY)/1000)}:F>`});
  if (c.notice_pending) fields.unshift({name:"Time off requested · checks paused",value:`${markdown(c.exception_reason||'Your request is with the team.',500)}\nStaff have not approved dates yet. Missed days won’t count while you wait. A chat message alone does not pause checks.`});
  if (c.exception_until && Date.parse(c.exception_until)>Date.now()) fields.unshift({name:"Time off approved · checks paused until",value:timestamp(c.exception_until)+"\nResume posting after this time. Approval runs from the time staff submit it; dates in the request are not applied automatically."});
  if (live) fields.push({name:"Before publishing",value:"Get your coach’s approval before publishing. Show the app or logo, verbally mention GoTall in talking videos, and follow the team’s caption and hashtag instructions. Cross-post to TikTok, Instagram and YouTube."},
    {name:"How posting is tracked",value:"Submit a TikTok share link or a full TikTok, Instagram or YouTube video link for each post. The bot records links; it does not verify the content or views. Three missed local posting days trigger a warning with four more days to act."});
  if(c.stage==='agreement' && !c.agreement_url)fields.push({name:"Signing link",value:"No real signing link has been attached. Ask the team here if you need the agreement."});
  const actions = [];
  if (c.stage === "warmup") actions.push(button("accounts","Add account links",1));
  if (c.stage === "account_review") actions.push(button("accounts","Edit answers",1));
  if (c.stage === "account_ready") actions.push(button("complete_warmup","Warm-up complete",1));
  if (c.stage === "first_video") actions.push(button("first_video","Submit first video",1));
  if (c.stage === "agreement") {
    actions.push(button("signed","Agreement signed",3));
    actions.push({type:2,style:5,label:"Review & sign",url:c.agreement_url || AGREEMENT_URL});
  }
  if (c.first_video_note && c.stage === "first_video") fields.push({name:"Requested video changes",value:markdown(c.first_video_note,500)});
  if (c.stage==='hub_ready') {
    actions.push(button('post','Submitted post',1));
    fields.unshift({name:'👇 Next steps',value:'1. Post your approved video to **TikTok and Instagram**.\n2. Come back here and choose **Submitted post**.\n3. Send both published links so we can record your posts.\n\nTikTok share links work too!'});
  }
  if (live) actions.push(button("post","Submitted post",1),button("leave","Request time off"));
  const result = card(title, description, c.stage === "at_risk" ? 0xed8b40 : 0x8b9c87,fields);
  return {...result,
    components:[...(actions.length?[row(...actions)]:[]),row(button("help","Explain this step"),button("guide","Full creator guide"),button("staff","Staff controls"))]};
}
export function creatorCommandsCard() {
  return card('Creator commands & account help',`Type a slash command in your private creator channel, select it from Discord’s menu, then press Enter.

**Check your progress · /status**
Use \`/status\` to see your current step and available buttons when you need to find your next action.

**Take time off · /status → Request time off**
Request a break before missing a posting day. Choose **Request time off**, enter your dates and reason, then submit. This is available during the trial and while active or At Risk. Posting checks pause while managers review the request; your manager confirms the approved period. During onboarding, ask your manager here about a delay.

**Leave the program**
Tell a manager in this private channel that you want to leave and your intended last posting date. Ask them to confirm your exit and any outstanding payments. There is currently no self-removal slash command; leaving the Discord server does not record an exit request.

**Payments · /payments**
Use \`/payments\` for monthly statements, payment status and your saved method. Use the month buttons for history and **Report a problem** for a missing payment or incorrect amount. You can also open **Payment hub** from the pinned directory.

**Your posts · /posts**
Use \`/posts\` to browse recorded videos, platform links and tracking snapshots. Use **Report a problem** for missing or incorrect links. After publishing an approved video, choose **Submitted post** and send both links.

**Start an application · /apply**
Use \`/apply\` if you have not applied yet. To check an existing application, use \`/status\`.

Need help or a correction? Ask your managers here. Staff review and approval commands are for managers only.`);
}
export function paymentCard(c={},resources={}) {
  const p=JSON.parse(c.payment_details||'null');
  const method={wise:'Wise',paypal:'PayPal',bank:'Bank transfer'}[p?.method]||'Not selected yet';
  const month=new Intl.DateTimeFormat('en-US',{month:'long',year:'numeric',timeZone:c.timezone||'UTC'}).format(new Date());
  const contact=resources.role_staff?`Ask <@&${resources.role_staff}> in your private creator channel.`:'Ask your managers in your private creator channel.';
  return {...card('💸 Your payment hub',`Manage your payment method and find payment information here.

**Amount owed · ${month}**
Not calculated yet. Your managers will confirm the amount after checking this month’s eligible videos and agreement terms.

**Your payment setup**
Method: **${method}**
Receiving currency: **${markdown(p?.currency||'USD')}**${p?.country?`
Receiving country: ${markdown(p.country)}`:''}${c.payment_updated_at?`
Last updated: ${timestamp(c.payment_updated_at)}`:''}

**When payments happen**
Payments typically happen after the end of the month—after the 31st in months with 31 days. Your manager will confirm the final amount and payment date.

**Questions or changes?**
${contact}
Choose a method below to add or update your details. Use **Full creator guide** for payment eligibility and agreement information. Saving details does not initiate a payment.`),allowed_mentions:{parse:[]},components:[row(button('pay_wise','Update Wise',1),button('pay_paypal','Update PayPal',1),button('pay_bank','Update bank transfer',1)),row(button('guide','Full creator guide'))]};
}
export function helpCard(c) {
  if (MESSAGE_STAGES[c.stage] || ["agreement_ready","agreement_review"].includes(c.stage)) return card("About this step", (MESSAGE_STAGES[c.stage] ? messageCopy(MESSAGE_STAGES[c.stage],c.name) : STAGES[c.stage][1]) + "\n\nUse the buttons on your status card to record completion. Chat messages alone do not advance onboarding. Staff approval is required before posting.");
  const detail={
    warmup:"**Add account links** saves the profiles staff should check and the timezone used to count posting days. Use full profile links, one per line.\n\n**Send for review** tells staff that setup is finished. Both links and a timezone must be saved first. If the team requested changes, fix those before resubmitting.",
    account_review:"The team is reviewing your profiles. No action is required until they approve them or leave specific changes in this channel. Approval unlocks the agreement; it does not start posting.",
    account_ready:"Staff must attach and send your agreement. You’ll see a signing button when a link is available. Your trial begins after signing, not after account approval.",
    agreement:"**Review & sign** opens your personal signing link. Read the terms and ask the team about anything unclear.",
    removal_due:"The posting deadline has passed. Ask staff in this channel if you want to restart; Reopen onboarding returns you to account setup and requires a new review and agreement.",
    removed:"Ask the team in this channel if you’d like to return. Staff can reopen account setup; you’ll need a new account review and agreement before posting resumes.",
  }[c.stage] || "**Submitted post** adds a published video to the review list. Open the post and copy its link; TikTok shortened share links and copied share text are supported. Repeating the same link does not count as a new post.\n\n**Request time off** sends your dates and reason to staff and pauses missed-day checks while they decide. Typing in chat does not pause checks automatically. Staff approval starts when they submit it.\n\nNeed help with a video? Send the link and your question in this channel.";
  return card('About this step',detail);
}
export function guideCard() {
  return card("Creating with GoTall", `**Before posting**\nCreate accounts → staff verification → warm-up and staff approval → signed agreement verified by staff → first-video review → Creator Hub and seven-day trial. Send concepts and drafts in your private channel for coaching; do not publish until approved. Use the status-card buttons to record completion.\n\n**Content and cross-posting**\nGet coach approval before posting. Show the app or logo; talking videos must mention GoTall. Follow the team’s caption and hashtag instructions. Cross-post approved videos to TikTok, Instagram and YouTube.\n\n**Agreement terms**\nThe supplied agreement specifies a $500 monthly completion payment for 30 qualifying videos, each reaching at least 500 views. It is not a guaranteed per-video payment. View milestones listed: 50K/$20, 100K/$50, 300K/$100, 500K/$250, 700K/$350, 1M/$500, 2M/$1,000. Views normally use the first seven days. Read the agreement for eligibility, termination and payment conditions. Bonus stacking and cross-platform view aggregation need clarification; this bot does not calculate settlement.\n\n[Read the creator agreement](${AGREEMENT_URL})\n\n**Time off**\nUse Request time off before missing a posting day. Three missed days lead to four full days At Risk. Pending requests pause checks.`);
}
export function staffCard(c, testMode) {
  const actions = [];
  if(c.stage === "account_review") actions.push(button("approve_account","Approve account",3),button("changes","Request changes"));
  if(c.stage === "warmup_review") actions.push(button("approve_warmup","Approve warm-up & send contract",3),button("changes","Request changes"));
  if(c.stage === "agreement_review") actions.push(button("confirm_signature","Verify signature",3));
  if(c.stage === "first_video_review") actions.push(button("approve_first_video","Approve first video",3),button("revise_first_video","Request video changes"));
  if(c.stage === "hub_ready") actions.push(button("open_hub","Open Creator Hub",3));
  if(c.stage === "agreement_ready") actions.push(button("agreement_link","Attach signing link"),button("send_agreement","Send agreement",1),button("changes","Request changes"));
  if(c.stage === "trial") actions.push(button("pass_trial","Pass trial",3),button("extend_trial","Extend by 3 days"));
  if(["trial","active","at_risk"].includes(c.stage)) actions.push(button("exception","Approve time off"));
  if(c.notice_pending) actions.push(button("deny_leave","Decline time off"));
  if(["removed","removal_due"].includes(c.stage)) actions.push(button("reopen","Reopen onboarding"));
  const components = actions.length ? [row(...actions)] : [];
  components.push(row(button("review_posts","Review posts"),button("profile","Application details")));
  const next = {warmup_review:"Check that warm-up is complete. Approve warm-up & send contract opens the signing step and notifies the creator in one action.",agreement_ready:"Send the supplied Jotform agreement, or attach an approved creator-specific link.",agreement_review:"Verify the completed Jotform submission and any required parent/guardian signature. Record a submission reference; the creator’s button is not signature proof.",first_video:"Coach the creator on their chosen format, then ask them to submit their draft for review.",first_video_review:"Review the draft before approving publication. Request revisions if needed.",hub_ready:"Open Creator Hub to grant access and begin the seven-day trial.",warmup:"Waiting for account links. The creator can send them for review from their status card.",account_review:"Check the account links and profiles. Approve them or explain what needs to change.",account_ready:"Waiting for the creator to finish warm-up and request review.",agreement:"Waiting for signing confirmation. Verify the Jotform submission before first-video preparation.",trial:"Review their posts after the trial ends. Approve them to continue or give them three more days.",active:"Review posts and handle time-off requests here.",at_risk:"Check for recent posts or a time-off request before the deadline.",removal_due:"The posting deadline has passed. Reopen onboarding if you want to run through it again.",removed:"Reopen onboarding if this creator is returning."}[c.stage];
  const fields=[];
  if(c.first_video_url) fields.push({name:"First video draft",value:`[Review draft](<${c.first_video_url}>)`});
  if(c.campaign_accounts)fields.push({name:'Accounts to review',value:accountLinks(c.campaign_accounts)});
  if(c.review_note)fields.push({name:'Last requested changes',value:markdown(c.review_note,500)});
  if(c.stage==='account_review')fields.push({name:'What these actions do',value:'Approve account unlocks warm-up; staff must approve warm-up before the agreement. Request changes sends the creator back to account setup with your written instructions. Neither starts the trial.'});
  if(c.stage==='agreement_ready')fields.push({name:'Signing link',value:c.agreement_url?`[Open attached agreement](<${c.agreement_url}>)\nSend agreement makes this link available on the creator’s card.`:'No signing link attached. Attach the creator-specific link first; Send agreement opens the signing step.'});
  if(c.stage==='trial')fields.push({name:'Trial review available after',value:c.trial_ends_at?timestamp(c.trial_ends_at):'Missing trial end date. Resolve this before approving.'},{name:'Review before deciding',value:'Use Review posts to inspect submitted links. Pass trial marks the creator active and is blocked before the end date. Extend by 3 days adds time from the later of now or the current end date.'});
  if(c.notice_pending)fields.unshift({name:'Time-off request · awaiting your decision',value:markdown(c.exception_reason||'No details provided.',500)+'\nChecks are paused until you decide.'});
  if(c.exception_until&&Date.parse(c.exception_until)>Date.now())fields.push({name:'Current approved leave ends',value:timestamp(c.exception_until)});
  if(['trial','active','at_risk'].includes(c.stage))fields.push({name:'Before approving time off',value:'Approval starts when you submit and runs for 1–30 days. The form does not apply the dates in the request automatically. Check the creator’s return date first; an existing later expiry is preserved.'});
  if(c.stage==='at_risk'&&c.risk_started_at)fields.unshift({name:'Deadline to post or request leave',value:timestamp(new Date(Date.parse(c.risk_started_at)+4*DAY).toISOString())});
  if(['removed','removal_due'].includes(c.stage))fields.push({name:'Reopen onboarding',value:'Returns the creator to account setup and clears their approval, agreement and trial dates. Previous submitted posts remain in the review history.'});
  return {...card("Staff review · "+markdown(c.name),`${next || "Check the creator’s status before continuing."}${false?'\n\nTest server: you can continue without a real signing link.':''}\n\nUse **/creator help** for command instructions, queues, history and recovery tools.`,0x8b9c87,fields),components};
}
