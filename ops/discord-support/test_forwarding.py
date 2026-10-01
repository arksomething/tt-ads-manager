import asyncio
import json
import os
import shlex
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock,patch
import diagnostics
import operations
import sandbox
import slack_forward
import support
import payment_profile


class ForwardTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.offer={'id':'100','author':{'id':str(support.OWNER_ID)},'content':'Payout report for August: USD 50. Please confirm.'}
        self.acceptance={'id':'200','author':{'id':'creator'},'content':'Yes, I accept USD 50.'}
        async def get(path):
            if '/messages?' in path:return [self.acceptance,self.offer]
            if path.endswith('/100'):return self.offer
            if path.endswith('/200'):return self.acceptance
            return {'roles':['staff']}
        self.api=SimpleNamespace(get=AsyncMock(side_effect=get))
        self.bound=support.SupportTools(self.api,None,{'staff_roles':['staff']},'g','c','creator','200')

    async def test_explicit_acceptance_forwards_source_evidence(self):
        with patch.object(slack_forward,'forward',new=AsyncMock(return_value={'state':'sent'})) as send,patch.object(payment_profile,'saved_profile',new=AsyncMock(return_value={'method':'paypal','destination':'creator@example.com'})):
            result=await self.bound.forward_to_michael('payout_acceptance','Creator accepted the offered amount.','100','200',amount='50',currency='USD',period='August')
            self.assertEqual(result['state'],'sent')
            self.assertTrue(self.bound.handoff_sent)
            self.assertIn('USD 50',send.await_args.args[1]);self.assertIn('/g/c/200',send.await_args.args[1])
            self.assertIn('Final send decision is yours',send.await_args.args[1])
            self.assertIn('PayPal',send.await_args.args[1]);self.assertIn('creator@example.com',send.await_args.args[1])
            self.assertNotIn('creator@example.com',json.dumps(result))
            self.assertLess(len(send.await_args.args[1]),400)

    async def test_staff_offer_without_owner_release_does_not_forward(self):
        self.offer['author']={'id':'manager'}
        with patch.object(slack_forward,'forward',new=AsyncMock()) as send:
            with self.assertRaises(PermissionError):await self.bound.forward_to_michael('payout_acceptance','x','100','200',amount='50',currency='USD',period='August')
            send.assert_not_awaited()

    async def test_plain_reply_after_owner_request_is_detected_without_bot_mention(self):
        client=support.SupportClient({},self.api,None)
        message=SimpleNamespace(id=200,author=SimpleNamespace(id=123,roles=[]),channel=SimpleNamespace(id='c'),content='Yes',reference=None)
        context=await client.payout_confirmation_context(message,{'staff_roles':[]})
        self.assertEqual(context,{'offer_message_id':'100','confirmation_request_message_id':'100','acceptance_message_id':'200'})

    async def test_newer_report_invalidates_old_confirmation(self):
        original=self.api.get.side_effect
        async def get(path):
            if '/messages?' in path:return [self.acceptance,{'id':'150','author':{'id':str(support.BOT_ID)},'content':'Corrected report','attachments':[{'filename':'new-payout-report.pdf'}]},self.offer]
            return await original(path)
        self.api.get.side_effect=get
        with patch.object(slack_forward,'forward',new=AsyncMock()) as send:
            with self.assertRaises(ValueError):await self.bound.forward_to_michael('payout_acceptance','x','100','200',amount='50',currency='USD',period='August')
            send.assert_not_awaited()

    async def test_report_without_confirmation_request_does_not_forward(self):
        self.offer['content']='Payout report for August: USD 50.'
        with patch.object(slack_forward,'forward',new=AsyncMock()) as send:
            with self.assertRaises(ValueError):await self.bound.forward_to_michael('payout_acceptance','x','100','200',amount='50',currency='USD',period='August')
            send.assert_not_awaited()

    async def test_unrelated_ok_does_not_forward(self):
        self.acceptance['content']='OK thanks'
        original=self.api.get.side_effect
        async def get(path):
            if '/messages?' in path:return [self.acceptance,{'id':'150','author':{'id':'creator'},'content':'Separate question about my video'},self.offer]
            return await original(path)
        self.api.get.side_effect=get
        with patch.object(slack_forward,'forward',new=AsyncMock()) as send:
            with self.assertRaises(ValueError):await self.bound.forward_to_michael('payout_acceptance','x','100','200',amount='50',currency='USD',period='August')
            send.assert_not_awaited()

    async def test_bugs_never_go_to_michael(self):
        with patch.object(slack_forward,'forward',new=AsyncMock()) as send:
            with self.assertRaises(ValueError):await self.bound.forward_to_michael('bug','Button broken')
            send.assert_not_awaited();self.api.get.assert_not_awaited()

    def test_handoff_ends_with_agent_invitation_even_for_long_answer(self):
        result=support.handoff_closing('Sent to Michael. '+('x'*2000))
        self.assertLessEqual(len(result),1900)
        self.assertTrue(result.endswith(support.CREATOR_INVITATION))
        self.assertIn('reply to this message',result)

    async def test_wrong_amount_does_not_forward(self):
        with patch.object(slack_forward,'forward',new=AsyncMock()) as send:
            with self.assertRaises(ValueError):
                await self.bound.forward_to_michael('payout_acceptance','x','100','200',amount='500',currency='USD',period='August')
            send.assert_not_awaited()

    async def test_missing_payment_details_blocks_incomplete_handoff(self):
        with patch.object(slack_forward,'forward',new=AsyncMock()) as send,patch.object(payment_profile,'saved_profile',new=AsyncMock(return_value=None)):
            with self.assertRaises(ValueError):
                await self.bound.forward_to_michael('payout_acceptance','x','100','200',amount='50',currency='USD',period='August')
            send.assert_not_awaited()

    def test_bank_fields_needed_to_send_are_preserved(self):
        result=payment_profile.format_profile({'method':'bank','recipient':'Test Creator','bank':'Example Bank','country':'US','currency':'USD','destination':'Account: TEST-ONLY; routing: TEST-ONLY'})
        self.assertIn('Example Bank',result);self.assertIn('routing: TEST-ONLY',result)

    async def test_rejection_conditional_and_other_creator_are_not_acceptance(self):
        with patch.object(slack_forward,'forward',new=AsyncMock()) as send:
            for text in ['No, I do not accept','Yes if you add USD 20','When can I get paid?']:
                self.acceptance['content']=text
                with self.assertRaises(ValueError):await self.bound.forward_to_michael('payout_acceptance','x','100','200')
            self.acceptance.update(content='Yes I accept',author={'id':'someone-else'})
            with self.assertRaises(PermissionError):await self.bound.forward_to_michael('payout_acceptance','x','100','200')
            send.assert_not_awaited()

    async def test_creator_cannot_supply_their_own_offer_as_staff(self):
        self.offer['author']={'id':'creator'}
        self.api.get.side_effect=[self.offer,self.acceptance,{'roles':[]}]
        with patch.object(slack_forward,'forward',new=AsyncMock()) as send:
            with self.assertRaises(PermissionError):await self.bound.forward_to_michael('payout_acceptance','x','100','200')
            send.assert_not_awaited()

    async def test_slack_uses_fixed_recipient_and_deduplicates_without_history(self):
        with tempfile.TemporaryDirectory() as tmp,patch.object(operations,'STATE',Path(tmp)),patch.object(slack_forward,'token',return_value='test-token'):
            (Path(tmp)/'config.json').write_text(json.dumps({'slack_forward':{'enabled':True,'michael_user_id':'U_MICHAEL'}}))
            response=SimpleNamespace(raise_for_status=lambda:None,json=lambda:{'ok':True,'channel':'D_M','ts':'1.1'})
            client=SimpleNamespace(post=AsyncMock(return_value=response))
            cm=AsyncMock();cm.__aenter__.return_value=client
            with patch.object(slack_forward.httpx,'AsyncClient',return_value=cm):
                first=await slack_forward.forward('one','Accepted amount')
                second=await slack_forward.forward('one','Accepted amount')
            self.assertEqual(first,second);client.post.assert_awaited_once()
            call=client.post.await_args
            self.assertEqual(call.args[0],'https://slack.com/api/chat.postMessage')
            self.assertEqual(call.kwargs['json']['channel'],'U_MICHAEL')


class IsolationTests(unittest.IsolatedAsyncioTestCase):
    def private_stores_check(self):
        # Check the actual host's home, including GitHub's ephemeral runner.
        # An absent hardcoded developer home would not prove isolation there.
        paths = [Path.home()/'.hermes/.env', Path.home()/'.codex/auth.json',
                 Path('/run/user')/str(os.getuid())/'bus']
        return ' && '.join(f'test ! -e {shlex.quote(str(path))}' for path in paths)

    async def test_creator_terminal_cannot_read_home_or_modify_source(self):
        # Exercise the real diagnostic snapshot and Bubblewrap sandbox with
        # temporary state. Installed unit liveness and systemd resource controls
        # belong to host verification, not this filesystem isolation regression.
        launch = asyncio.create_subprocess_exec

        async def portable_launch(*args, **kwargs):
            if args[0] == 'systemctl':
                return await launch('/bin/echo', 'inactive', **kwargs)
            self.assertEqual(args[0], 'systemd-run')
            return await launch(*args[args.index('/usr/bin/bwrap'):], **kwargs)

        with tempfile.TemporaryDirectory() as tmp, patch.object(operations, 'STATE', Path(tmp)), \
                patch.object(diagnostics.asyncio, 'create_subprocess_exec', side_effect=portable_launch):
            result=await diagnostics.read_terminal(self.private_stores_check()+" && echo private-stores-hidden; touch /workspace/code/flow.mjs")
        self.assertIn('private-stores-hidden',result['output'])
        self.assertNotEqual(result['exit_code'],0)
        self.assertIn('Read-only file system',result['output'])

    def test_delegated_project_hides_home_and_keeps_gateway_readonly(self):
        import subprocess
        command=self.private_stores_check()+" && test ! -w ops/discord-support/support.py && test -w ops/creator-platform/discord-onboarding-bot/messages.mjs && echo isolated-project-ok"
        result=subprocess.run(sandbox.project(command,sandbox.REPO),capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn('isolated-project-ok',result.stdout)


if __name__=='__main__':unittest.main()
