# Recovery of eight stale TikTok accounts

Verified September 9, 2026, 07:16 EDT. All eight started at 0% current coverage in the earlier snapshot. Current coverage counts directly observed, non-overdue videos among non-frozen videos not currently classified unavailable. Denominators may change as videos are discovered or reach 90 days.

| Creator | Before | Current | Remaining overdue | Result |
|---|---:|---:|---:|---|
| @heightible | 0% | 77.9% (53/68) | 15 | 15 stale videos remain in retry backoff; subsequent retries use the reconciled handle. One video aged out of the 90-day active denominator during verification. |
| @dgetstaller | 0% | 0.0% (0/28) | 28 | Stable-ID profile lookup returns an empty inventory; terminal cursor parser failure fixed. No video measurements recovered. |
| @gotall.dan | 0% | 0.0% (0/30) | 30 | Stable-ID profile lookup returns an empty inventory. No video measurements recovered. |
| @intercepzion | 0% | 95.2% (20/21) | 1 | One missing video returned HTTP 404. |
| @mansuhn.gotall | 0% | 100.0% (32/32) | 0 | All eligible videos current. |
| @matthew.gotall | 0% | 100.0% (28/28) | 0 | All eligible videos current. |
| @thesompr | 0% | 100.0% (27/27) | 0 | All eligible videos current. |
| @will.gotall | 0% | 100.0% (30/30) | 0 | All eligible videos current. |

191 direct observations were saved during targeted recovery. Empty provider responses and 404s do not establish that a creator is owed zero, nor do current measurements recreate historical seven-day payout evidence.
Deployed fixes: overdue ordinary scheduling priority while preserving real target deadlines; native account-ID profile lookup with returned-owner checks; current-handle video retry URLs; terminal-page cursor handling. Final release: `7f8d235c72500db955b2433593efcd6fcd5ccfd2100b420de15e7a0c06e62bec`, app commit `178dd6362b883b766cbb501091d4a3ab7bfe4b2f`. All 829 tests, typechecking, production build, dependency audit, and 46-page completeness gate passed. Worker HTTP health passed and all eight collection timers were enabled. Temporary recovery units were removed.
