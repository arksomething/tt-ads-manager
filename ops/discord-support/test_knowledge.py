import unittest
from knowledge import business_context


class BusinessKnowledgeTests(unittest.TestCase):
    def test_shared_context_has_current_org_and_monthly_payment_model(self):
        context = business_context()
        for phrase in ('Judy / Blazie / judydoesugc', 'monthly settlement in arrears',
                       'first seven days after publication', 'carryover',
                       'not the new creator', 'nonbinding', '24 hours'):
            self.assertIn(phrase, context)

    def test_payment_schedule_is_available_to_creators_and_operators(self):
        for operator in (False, True):
            context = business_context(operator)
            self.assertIn('usually on the 2nd', context)
            self.assertIn('not a guaranteed arrival', context)
            self.assertIn('does not establish that money was sent or received', context)

    def test_business_purpose_is_loaded_for_creators_and_operators(self):
        for operator in (False, True):
            context = business_context(operator)
            for phrase in ('helps teenagers predict their height',
                           'user-generated content (UGC)', 'paying customers',
                           'grow revenue and profit', 'Views matter',
                           'not a promise of increased height'):
                self.assertIn(phrase, context)

    def test_historical_staff_exceptions_are_not_in_creator_context(self):
        shared = business_context(False)
        operator = business_context(True)
        self.assertNotIn('Dobbin and xCynu', shared)
        self.assertIn('Dobbin and xCynu', operator)
        self.assertNotIn('Transcript-derived payout lessons', shared)
        self.assertIn('not proof', shared)
