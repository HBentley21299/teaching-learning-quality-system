# Staff Import Validation Rules

CSV staff imports should be staged, validated, previewed, then committed.

Required checks:

- Staff external ID is present and unique.
- Email is present and unique among active accounts.
- Faculty or org unit codes exist before commit.
- Line manager references resolve to a staff member.
- Role codes map to configured roles.
- Leavers are archived rather than deleted.
- The import summary reports added, updated, archived, skipped, and failed rows.

