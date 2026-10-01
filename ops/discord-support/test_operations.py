import json
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import operations
import support


class OperatorTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.api=SimpleNamespace(get=AsyncMock(return_value={'roles':['staff']}),request=AsyncMock(return_value={'id':'888','name':'changed'}))
        self.cfg={'staff_roles':['staff'],'operators':['blazie']}
        self.bound=support.SupportTools(self.api,None,self.cfg,'g','c','blazie','m')

    async def test_named_operator_gets_tools_but_other_staff_does_not(self):
        self.assertTrue((await self.bound.authenticate())['operator'])
        names={x['function']['name'] for x in self.bound.registry().get_definitions()}
        self.assertTrue({'run_command','command_status','discord_request'} <= names)
        self.bound.author='other-staff'
        self.assertFalse((await self.bound.authenticate())['operator'])
        self.assertNotIn('run_command',{x['function']['name'] for x in self.bound.registry().get_definitions()})

    async def test_guild_owner_does_not_get_operator_access(self):
        self.cfg['owner']='different-server-owner'
        self.bound.author='different-server-owner'
        self.assertFalse((await self.bound.authenticate())['operator'])
        self.assertNotIn('run_command',{x['function']['name'] for x in self.bound.registry().get_definitions()})
        with self.assertRaises(PermissionError):await self.bound.require_operator()

    async def test_account_owner_gets_operator_access_without_staff_role(self):
        self.bound.author=str(support.OWNER_ID)
        self.api.get.return_value={'roles':[]}
        self.assertTrue((await self.bound.authenticate())['operator'])

    async def test_role_revocation_blocks_already_registered_tool(self):
        await self.bound.authenticate()
        registry=self.bound.registry()
        self.api.get.return_value={'roles':[]}
        with patch.object(operations,'start_job',new=AsyncMock()) as launch:
            result=await registry.execute('run_command',{'command':'touch /tmp/should-not-exist'})
            self.assertIn('error',result);launch.assert_not_awaited()

    async def test_identity_is_not_taken_from_tool_arguments(self):
        await self.bound.authenticate()
        with patch.object(operations,'start_job',new=AsyncMock(return_value={'state':'running'})) as launch:
            await self.bound.run_command('pwd')
            identity=launch.await_args.args[2]
            self.assertEqual(identity['user_id'],'blazie')
            self.assertEqual(identity['source_message'],'m')

    async def test_discord_mutation_is_deduplicated_and_requires_same_guild(self):
        with tempfile.TemporaryDirectory() as tmp,patch.object(support,'STATE',Path(tmp)):
            self.api.get.side_effect=lambda path: {'roles':['staff']} if '/members/' in path else {'guild_id':'g'}
            one=await self.bound.discord_request('PATCH','/channels/123',{'name':'changed'})
            two=await self.bound.discord_request('PATCH','/channels/123',{'name':'changed'})
            self.assertEqual(one,two);self.api.request.assert_awaited_once()
            self.api.get.side_effect=lambda path: {'roles':['staff']} if '/members/' in path else {'guild_id':'other'}
            with self.assertRaises(PermissionError):await self.bound.discord_request('GET','/channels/999')

    async def test_ambiguous_discord_mutation_is_not_retried(self):
        with tempfile.TemporaryDirectory() as tmp,patch.object(support,'STATE',Path(tmp)):
            self.api.request.side_effect=TimeoutError()
            with self.assertRaises(TimeoutError):await self.bound.discord_request('POST','/guilds/g/channels',{'name':'new'})
            result=await self.bound.discord_request('POST','/guilds/g/channels',{'name':'new'})
            self.assertEqual(result['state'],'outcome_unknown');self.api.request.assert_awaited_once()

    async def test_command_retries_reuse_job_even_if_role_metadata_changes(self):
        with tempfile.TemporaryDirectory() as tmp,patch.object(operations,'JOBS',Path(tmp)):
            proc=SimpleNamespace(wait=AsyncMock(return_value=0))
            with patch.object(operations.asyncio,'create_subprocess_exec',new=AsyncMock(return_value=proc)) as launch,patch.object(operations.asyncio,'sleep',new=AsyncMock()):
                identity={'guild':'g','channel':'c','user_id':'u','source_message':'m','role_ids':['one']}
                first=await operations.start_job('pwd',tmp,identity)
                second=await operations.start_job('pwd',tmp,{**identity,'role_ids':['two']})
                self.assertEqual(first['job_id'],second['job_id']);launch.assert_awaited_once()


class JobTests(unittest.TestCase):
    def test_recent_jobs_are_scoped_and_do_not_expose_commands_or_output(self):
        with tempfile.TemporaryDirectory() as tmp,patch.object(operations,'JOBS',Path(tmp)):
            identity={'guild':'g','channel':'c','user_id':'u','source_message':'m'}
            for index,changes in enumerate([{}, {'guild':'other'}, {'channel':'other'}, {'user_id':'other'}]):
                jid=str(index)*32
                operations.save(Path(tmp)/f'{jid}.request.json',{'job_id':jid,'identity':{**identity,**changes},'created_at':time.time(),'command':'PRIVATE COMMAND'})
                operations.save(Path(tmp)/f'{jid}.result.json',{'state':'completed','output':'PRIVATE RESULT'})
            jobs=operations.recent_jobs(identity)
            self.assertEqual(len(jobs),1);self.assertEqual(jobs[0]['source_message'],'m')
            self.assertNotIn('PRIVATE',json.dumps(jobs))

    def test_job_can_run_onboarding_node_sqlite_runtime(self):
        with tempfile.TemporaryDirectory() as tmp,patch.object(operations,'JOBS',Path(tmp)):
            jid='b'*32
            command='node --input-type=module -e "import {DatabaseSync} from \'node:sqlite\'; const db=new DatabaseSync(\':memory:\'); console.log(db.prepare(\'select 42 as proof\').get().proof)"'
            operations.save(Path(tmp)/f'{jid}.request.json',{'command':command,'cwd':tmp})
            operations.run_job(jid)
            result=json.loads((Path(tmp)/f'{jid}.result.json').read_text())
            self.assertEqual(result['exit_code'],0);self.assertIn('42',result['output'])

    def test_actual_shell_edit_and_result(self):
        with tempfile.TemporaryDirectory() as tmp,patch.object(operations,'JOBS',Path(tmp)):
            jid='a'*32
            operations.save(Path(tmp)/f'{jid}.request.json',{'command':"printf verified > proof.txt; cat proof.txt",'cwd':tmp})
            operations.run_job(jid)
            result=json.loads((Path(tmp)/f'{jid}.result.json').read_text())
            self.assertEqual(result['exit_code'],0);self.assertEqual(result['output'],'verified')
            self.assertEqual((Path(tmp)/'proof.txt').read_text(),'verified')
            self.assertFalse((Path(tmp)/f'{jid}.log').exists())

    def test_foreign_job_and_path_traversal_rejected(self):
        with tempfile.TemporaryDirectory() as tmp,patch.object(operations,'JOBS',Path(tmp)):
            jid='a'*32
            operations.save(Path(tmp)/f'{jid}.request.json',{'identity':{'guild':'other'}})
            with self.assertRaises(PermissionError):operations.job_status(jid,{'guild':'g'})
            with self.assertRaises(ValueError):operations.job_status('../config',{'guild':'g'})

    def test_redacts_json_tokens_and_authorization(self):
        result=operations.redact('Authorization: Bot abcdefghijklm\n{"token":"private-key"}')
        self.assertNotIn('abcdefghijklm',result);self.assertNotIn('private-key',result)

    def test_completion_receipt_is_durable_deduplicated_and_has_no_output(self):
        with tempfile.TemporaryDirectory() as tmp,patch.object(operations,'JOBS',Path(tmp)):
            store=support.Store(Path(tmp)/'state.sqlite3')
            store.admit('m','g','c','u','request');store.finish('m','started',{})
            jid='a'*32
            operations.save(Path(tmp)/f'{jid}.request.json',{'job_id':jid,'identity':{'source_message':'m','user_id':'u','channel':'c','guild':'g'}})
            operations.save(Path(tmp)/f'{jid}.result.json',{'state':'completed','exit_code':0,'output':'PRIVATE PROVIDER OUTPUT'})
            client=support.SupportClient({},None,store)
            client.enqueue_finished_jobs();client.enqueue_finished_jobs()
            rows=store.db.execute('SELECT * FROM outbox').fetchall()
            self.assertEqual(len(rows),1);self.assertNotIn('PRIVATE',rows[0]['content'])
            self.assertNotIn(jid,rows[0]['content']);self.assertNotIn('exit',rows[0]['content'])
            self.assertIn('check it',rows[0]['content']);self.assertIn('/g/c/m',rows[0]['content'])
            self.assertEqual(rows[0]['user'],'u')
            # A model failure after launching a job must not suppress its receipt.
            store.admit('failed-turn','g','c','u','second request')
            store.finish('failed-turn',support.SAFE_FAILURE,{'failed':True})
            other='b'*32
            operations.save(Path(tmp)/f'{other}.request.json',{'job_id':other,'identity':{'source_message':'failed-turn','user_id':'u','channel':'c','guild':'g'}})
            operations.save(Path(tmp)/f'{other}.result.json',{'state':'completed','exit_code':1,'output':'PRIVATE PROVIDER OUTPUT'})
            client.enqueue_finished_jobs()
            row=store.db.execute('SELECT * FROM outbox WHERE id=?',('job-'+other,)).fetchone()
            self.assertIsNotNone(row)
            self.assertNotIn('PRIVATE',row['content'])
            store.db.close()


if __name__=='__main__':unittest.main()
