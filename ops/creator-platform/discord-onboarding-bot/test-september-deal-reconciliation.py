import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('reconcile',Path(__file__).with_name('reconcile-september-2026-deals.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)


class ReconciliationTests(unittest.TestCase):
    def row(self,creator,**changes):
        return {'creator_id':creator,'campaignCreatorId':creator+'-campaign','isTalking':False,
                'cpmAmount':.5,'fixedFee':None,'fixedFeePerVideo':10,
                'effectiveStartDate':'2026-07-20T00:00:00+00:00',**changes}

    def test_cutoff_switches_exceptions_and_fixed_fees(self):
        rows=[self.row(x) for x in module.SWITCHES]+[
            self.row('regular'),self.row(module.EXEMPT),self.row('talker',isTalking=True,cpmAmount=1),
            self.row('special-talking-terms',cpmAmount=1)]
        plan=module.make_plan(rows)
        self.assertEqual(len(plan['changes']),3)
        ordinary=next(x for x in plan['changes'] if x['before']['creator_id']=='regular')
        self.assertEqual(ordinary['effective_at'],module.CUTOFF)
        self.assertEqual(ordinary['prior_end'],'2026-09-17T15:00:27.510000+00:00')
        self.assertEqual(ordinary['cpm'],.2)
        self.assertEqual(ordinary['before']['fixedFeePerVideo'],10)
        for switch in [x for x in plan['changes'] if x['switch_to_talking']]:
            self.assertEqual((switch['cpm'],switch['cap']),(1,300))
            self.assertEqual(switch['effective_at'],module.SWITCHES[switch['before']['creator_id']][0])
        self.assertEqual(plan,module.make_plan(rows))

    def test_lump_sum_cannot_be_accidentally_recognized_twice(self):
        with self.assertRaisesRegex(AssertionError,'lump-sum'):
            module.make_plan([self.row(x) for x in module.SWITCHES]+[self.row('fee',fixedFee=300)])


if __name__=='__main__':unittest.main()
