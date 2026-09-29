# Local system test data

Loaded on 29 September 2026 at Harry's explicit request. This is an additive fixture for the local TLQS database, not production data or a startup seed.

Select academic year **2026/27**. Records are prefixed **[SYSTEM TEST 26/27]**. The 12 fictional staff are **Test Colleague 01–12**, with external IDs `SYSTEM-TEST-01` through `SYSTEM-TEST-12` and non-deliverable `@ielevate.local` addresses. No login passwords were created.

They belong to Digital, Health and Social Care, Business, Sport, Brickwork, Hair and Beauty, WBL Business, Adult English/Maths, ESOL, Supported Education, UCO and ALS. Their explicit memberships and test reporting lines make them visible in the local administrator's My Team. Existing staff and organisation assignments were preserved.

| Process | Test records |
|---|---:|
| ELI | 12 |
| LIV | 12 |
| ALS LIV | 3 |
| Learning Walk | 12 |
| ALS Learning Walk | 3 |
| Work Scrutiny | 12 |
| Coaching and Mentoring | 12 |
| Probation | 12 |
| Learning Environments | 12 |
| Internal / external CPD | 12 / 3 |
| QA reviews | 2 open |
| QA evidence | 16 submitted, covering all 8 current activities |
| UCO TLA | 3, at completed and pending stages |

Total: **126 core records**, **108 linked actions**, **12 staff**. ELI includes saved statement responses and development plans. Generic submissions contain form answers. QA contains 210 criterion responses across the two reviews. UCO includes narrative responses and linked actions. Mandatory CPD is not loaded: its separate migration/template remains pending approval.

Test Colleagues 01–04 have Elevate levels 1–4 respectively, supported by 3, 6, 9 and 12 actual attended internal CPD events. All preceding award levels exist, and the level-one award includes synthetic implementation evidence. External CPD receives zero milestone credit.

Verified through the running application: all ten main process keys appear in dashboard data; both QA dashboards show eight evidence submissions and 105 ratings; UCO returns its three reviews; My Team displays the four awarded levels; a test staff profile opens successfully. SQL verification found no seeded generic submission lacking answer rows. Existing non-fixture records remain present.

To reuse explicitly: `scripts/load-local-system-test-data.ps1`. The loader is LocalDB/TLQS-only and invokes fixtures 012, 014, 013 and 015. Each uses a transaction and rerun guards. It is never called by application startup. The first core-process attempt rolled back on a LIV/ALS uniqueness constraint; the corrected run completed successfully. No database migration, reset, GitHub write or deployment was performed.
