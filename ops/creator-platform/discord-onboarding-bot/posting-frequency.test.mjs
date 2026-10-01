import test from 'node:test';
import assert from 'node:assert/strict';
import {creatorGuide,statusCard,guideCard,faqCard} from './flow.mjs';
import {messageCopy,creatorDecision} from './messages.mjs';
test('new-deal posting frequency appears throughout onboarding and ongoing guidance',()=>{
  const c={cohort:'new',stage:'active',name:'Creator'};
  for(const card of [creatorGuide(c),statusCard(c),guideCard(),statusCard({...c,stage:'hub_ready'})]) assert.match(card.embeds[0].description,/2 distinct approved videos per day/);
  for(const step of [6,9]) assert.match(messageCopy(step,'Creator'),/2 distinct approved videos per day/);
  for(const action of ['approve_first_video','pass_trial','extend_trial']) assert.match(creatorDecision(action,c)[1],/2 distinct approved videos per day/);
  assert.match(faqCard(999).embeds[0].description,/2 distinct approved videos per day/);
});
test('legacy private guidance and decisions preserve their agreed schedule',()=>{
  const c={cohort:'legacy',stage:'active',name:'Creator'};
  for(const card of [creatorGuide(c),statusCard(c)]) assert.doesNotMatch(card.embeds[0].description,/2 distinct/);
  assert.doesNotMatch(creatorDecision('pass_trial',c)[1],/2 distinct/);
});
