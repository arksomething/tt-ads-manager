// Copy supplied by Blazie; retrieved 2026-09-10. See MESSAGE-SOURCES.md.
export const AGREEMENT_URL = "https://form.jotform.com/262506982690062";
export function creatorDecision(action,c,reason='') {
  const notes={
    approve_account:['🎉 Your accounts are approved!',`Nice work, ${String(c.name).replace(/[<>@]/gu,'')}! Your TikTok and Instagram accounts have been approved. You’re ready to warm up your accounts!`],
    approve_warmup:['✅ Warm-up approved — your contract is ready!','Nice work! Your warm-up has been approved. Open your status card and choose **Review & sign**, then return and choose **Agreement signed** once you’re done. Please wait for signature verification before filming or posting.'],
    send_agreement:['📄 Your creator agreement is ready!','Review and sign your agreement, then choose **Agreement signed** on your status card. Ask the team here if anything is unclear.'],
    confirm_signature:['🎥 You’re ready for your first video!','Your agreement has been verified! Check the first-video instructions, choose your format with the team, then submit your draft for review.'],
    approve_first_video:['🔥 Your video is approved — time to post!','Nice work! Post your approved video to TikTok and Instagram.\n\nOnce it’s live, come back here and choose **Submitted post** on your status card. Send both published links so we can record your posts. TikTok share links work too!'],
    changes:['🔎 A quick update on your accounts','The team requested changes to your accounts. Submit your updated account details to send them back for review.'],
    revise_first_video:['🎥 Feedback on your draft is ready','The team has shared changes for your video. Update your draft, then choose **Submit first video** to send it back for review.'],
    pass_trial:['🎉 You passed your trial!','Welcome to the team! Keep creating and submit each published post through your status card.'],
    extend_trial:['📅 Your trial has been extended','You have three more days to keep creating. Check your updated trial date and continue submitting your posts.'],
    exception:['✅ Your time off is approved',`Posting checks are paused until <t:${Math.floor(Date.parse(c.exception_until)/1000)}:F>. Resume posting after that time; your status card shows the approved period.`],
    deny_leave:['An update on your time-off request','The team could not approve this request. Please resume posting and check the feedback below. The days you spent waiting for this decision won’t count against you.'],
    reopen:['👋 Let’s get you set up again!','Your onboarding has been reopened. Add your account details, then send them for a fresh review.'],
  };
  const result=notes[action];
  if(!result)return null;
  return [result[0],result[1]+(reason&&['changes','revise_first_video','deny_leave'].includes(action)?`\n\n**Feedback from the team:** ${reason}`:'')+'\n\n👇 [Check your status card for the next steps]({status_link}).'];
}
export function creatorSuccess(action, creator) {
  // Reuse the supplied creator copy in short receipts, without repeating the
  // complete status card after each action.
  const line=(number,starts)=>messageCopy(number,creator.name).split('\n').find(s=>s.startsWith(starts));
  return {
    accounts:`✅ ${line(5,'Nice work,')} Your accounts are submitted for review!\nI’ll go through your profiles and make sure everything looks good.\n\n⏳ We’ll notify you here when the review is complete.`,
    ready:`🔎 Great — your accounts are ready for review!\nI’ll go through your profiles and make sure everything looks good.\n\n${line(3,'⏳')}`,
    complete_warmup:`✅ ${line(5,'Nice work,')}\n${line(5,"I've received")}\n${line(5,"I'll let")}`,
    signed:`📄 Got it! Your signing confirmation is with the team.\n${line(6,"I'll confirm")}`,
    first_video:`🎥 ${line(8,'Got it,')}\n${line(8,"I'll send")}\n\n${line(8,'⏳')} ${line(8,"I'll let")}`,
    post:`🎉 Congratulations, ${creator.name}! Your posts are live and your links are saved!\nYou’ve taken your approved video all the way from idea to publication. Nice work! 🙌\n\n**Keep it going**\n• Get the team’s approval before publishing new videos.\n• Show the GoTall app or logo; mention GoTall aloud in talking videos.\n• Follow the team’s captions, hashtags and disclosure instructions.\n• Post to TikTok and Instagram and send both links here.\n\n📌 Your pinned message is now your creator directory — use it for resources, policies, payment setup and your next posts.`,
    leave:'✅ Got it — thanks for keeping us in the loop!\nYour time-off request is with the team. Missed-day checks are paused while we review your dates.',
  }[action];
}
export const templates = [
  "👋 Welcome to the GoTall Creator Program, {{first_name}}!\nYou’re officially inside.\nBefore you can start creating, we need to get a few things set up.\nYour next step:\nPlease complete the onboarding form below 👇\n[COMPLETE ONBOARDING →]\nYou’ll be asked for:\nYour first name\nYour country\nYour phone number\nYour TikTok/Instagram information\nYour best previous video\nOnce you complete it, we’ll automatically create your private onboarding channel inside the server.\nThat’s where you’ll work directly with the team while getting set up.\nPlease complete this before doing anything else. ✅\n",
  "🎉 Welcome to your private onboarding room, {{first_name}}!\nThis channel is just for you + the GoTall team.\nWe'll use this space to get you completely set up before you enter the Creator Hub.\n🟢 YOUR ONBOARDING\nStep 1 — Create Your Creator Accounts 🔐\nWe'll guide you through setting up the accounts you'll use for GoTall.\nStep 2 — Verification 🔎\nWe'll verify your accounts and make sure everything is ready.\nStep 3 — Warm Up Your Account 📱\nWe'll guide you through setting up the accounts you'll use for GoTall.\nStep 4 — Creator Agreement 📄\nYou'll review and sign the agreement.\nStep 5 — First Video 🎥\nOnce your account is ready, we'll help you choose your first concept and review your first video.\nStep 6 — Enter the Creator Hub 🚀\nOnce everything is approved, you'll receive access to the scripts, assets, submissions, and creator community.\n👇 START HERE\n🔐 Account Creation Guide:\n[NOTION ACCOUNT-CREATION LINK]\nOnce you've done everything, send a message saying ‘DONE’.\nI'll then check your progress and we'll take it from there.\nDon't worry about figuring everything out yourself — we'll guide you through it.\n",
  "🔎 STEP 2 — VERIFY YOUR ACCOUNTS\nGreat — your accounts are created. Now we need to check that everything is set up correctly before you move forward.\n👇 SEND YOUR ACCOUNTS HERE\nPlease send the links to your TikTok and/or Instagram profiles below.\nOnce you send them, I'll go through your profiles and make sure everything looks good.\nExample:\nTikTok: https://tiktok.com/@username\nInstagram: https://instagram.com/username\nOnce you've sent them, just say “SENT” and I'll review them.\n⏳ Please wait for my approval before moving to the next step.\n",
  "📱 STEP 3 — WARM UP YOUR ACCOUNT\nBefore you start posting, we need to properly warm up your account.\nThis is an important step — don't rush through it. I'll guide you through exactly what to do so your account is ready for content.\n👇 START HERE\n📖 Warm-Up Guide:\n[NOTION WARM-UP LINK]\nGo through the guide carefully and complete all the steps inside.\nOnce you've finished everything, come back here and send:\n“WARM-UP COMPLETE”\nI'll check your progress and let you know when you're ready for the next step.\n⚠️ Don't start posting GoTall content yet. Wait for my approval first.\n",
  "✅ WARM-UP COMPLETE\nNice work, {{first_name}}.\nI've received your completion message and will now check your account/setup.\nI'll let you know once you're cleared to move on to Step 4 — Creator Agreement.\n⏳ For now, just wait for my confirmation.\n",
  "📄 STEP 4 — CREATOR AGREEMENT\nYou're almost there.\nBefore you start creating content for GoTall, you'll need to review and sign the Creator Agreement.\nThe agreement covers the important details of the program, including your responsibilities, content requirements, compensation, and other terms.\n👇 READ & SIGN\n📄 Creator Agreement:\n[AGREEMENT LINK]\nPlease read the entire agreement carefully.\nIf everything is clear, complete the signing process at the end.\nOnce you've signed it, come back here and send:\n“AGREEMENT SIGNED”\nI'll confirm everything on my end and then we'll move you to your first video.\nIf you have any questions about the agreement, ask before signing.\n",
  "🎥 STEP 5 — LET'S MAKE YOUR FIRST VIDEO\nYou've made it to the fun part.\nBefore you start filming, I want you to look through our collection of formats that are currently performing well.\n👇 FIND YOUR FORMAT\n📚 Winning Formats:\n[NOTION WINNING FORMATS LINK]\nGo through the different formats and find one video/format that you genuinely like and would want to recreate.\nDon't worry about making it perfect yet.\nOnce you've found one, send the video link here and tell me:\n“I want to make this one.”\nI'll look at it, show you exactly how I'd approach the video, and give you the instructions you need to make your version.\nAfter you film it, send it to me for review and I'll give you feedback before you move forward.\n🔥 The goal isn't to reinvent the wheel — it's to take formats that are already working and make them your own.\n",
  "🎥 VIDEO RECEIVED\nGot it, {{first_name}}.\nI'll review your first video and check the important things before giving you the green light:\nHook & format\nDelivery\nEditing & pacing\nApp visibility\nOverall quality\nCTA\nI'll send you feedback if anything needs to be changed.\n⏳ For now, don't post it yet.\nI'll let you know when it's approved and you're ready to move forward. \n",
  "🔥 FIRST VIDEO APPROVED\nYou're officially ready to start creating for GoTall.\nYour first video has been approved, so there's just one final step before you enter the Creator Hub.\n🚀 NEXT UP\nI'll now give you access to everything you need to start posting:\nScripts\nWinning formats\nAssets\nSubmission system\nCreator resources\nCreator community\nI'll let you know as soon as your Creator Hub access is ready.\nWelcome to the team, {{first_name}}. 🤝 \n",
  "🚀 YOU'RE OFFICIALLY IN\nCongratulations, {{first_name}} — you've completed onboarding.\nYour access to the GoTall Creator Hub is now unlocked.\nFrom here, you'll have everything you need to create, post, and submit your content.\n📚 YOUR CREATOR HUB\n📜 #sript-library — Find proven scripts and concepts\n🎥 #winning-formats — See what's currently working\n📦 #assets — Access the GoTall assets you need\n💬 #creator-community — Connect with other creators\n🎯 YOUR FIRST MISSION\nHead over to #script-library DAILY, to choose a concept you want to make, and start creating.\nFrom this point forward, submit your videos here for Judy to approve it.\nWelcome to the GoTall Creator Program. 🔥\nLet's get you paid."
];

export const GUIDE_LINKS = {accountCreation:'https://example.com/gotall/account-creation', warmup:'https://example.com/gotall/warm-up', formats:'https://example.com/gotall/winning-formats'};
export function accountCreationGuide() {
  return `[Account creation guide — placeholder, coming soon](<${GUIDE_LINKS.accountCreation}>)`;
}
export function messageCopy(number, name = '', links = GUIDE_LINKS) {
  const firstName = String(name).trim().replace(/([\\`*_~|<>])/gu, '\\$1');
  const guide = (key, label) => {
    try { const u = new URL(links[key]); if(u.protocol === 'https:' && !u.username && !u.password) return `[${label}${u.hostname === "example.com" ? " — placeholder, coming soon" : ""}](<${u.href}>)`; } catch {}
    return `Ask the team here for the ${label.toLowerCase()} before continuing.`;
  };
  let template = templates[number - 1].trim();
  if(number === 9) {
    template = "🔥 Nice work, {{first_name}}! Your first video is approved and ready to post.";
  }
  if(number === 3) {
    template = "🔎 Your accounts are with the team for review.\n\nI'll go through your profiles and make sure everything looks good.\n\n⏳ Please wait for approval before moving to the next step. We’ll ping you here when your review is complete.";
  }
  if(number === 2) {
    const [welcome, rest] = template.split('🟢 YOUR ONBOARDING\n');
    const [overview, start] = rest.split('👇 START HERE\n');
    template = welcome.trim() + '\n\n**👇 Start here**\n' + start.trim()
      .replace('🔐 Account Creation Guide:\n', '')
      .replace('[NOTION ACCOUNT-CREATION LINK]\n', '[NOTION ACCOUNT-CREATION LINK]\n\n')
      .replace("I'll then check", "\nI'll then check")
      + '\n\n**🟢 Your onboarding**\n\n' + overview.trim()
        .replace(/^(Step \d — .+)$/gmu, '**$1**')
        .replace(/\n(?=\*\*Step)/gu, '\n\n');
  }
  return template
    .replaceAll('{{first_name}}', firstName || 'creator')
    .replace('Please complete the onboarding form below 👇', 'Start onboarding by filling out the form below 👇')
    .replace('[COMPLETE ONBOARDING →]', '**Choose Start onboarding below.**')
    .replace('Your best previous video', 'Your best previous video (optional)')
    .replace('[NOTION ACCOUNT-CREATION LINK]', guide('accountCreation', 'Account creation guide'))
    .replace('[NOTION WARM-UP LINK]', guide('warmup', 'Warm-up guide'))
    .replace('[NOTION WINNING FORMATS LINK]', guide('formats', 'Winning formats'))
    .replace('[AGREEMENT LINK]', AGREEMENT_URL)
    .replace('#sript-library', '#script-library')
    .replace('Once you\'ve done everything, send a message saying ‘DONE’.', '1. Follow the account creation guide.\n2. Choose **Add account links** and submit your TikTok and Instagram accounts. They’ll go straight to the team for review.')
    .replace('Once you\'ve sent them, just say “SENT” and I\'ll review them.', 'Your saved account links are with the team for review.')
    .replace('“WARM-UP COMPLETE”', '**Choose Warm-up complete on your status card.**')
    .replace('“AGREEMENT SIGNED”', '**Choose Agreement signed on your status card.**');
}
