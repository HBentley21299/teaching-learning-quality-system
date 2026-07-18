# Export template implementation contract

The five retained `.docx` files in this directory are the design authority for individual record exports. They are copied byte-for-byte from the user-supplied files and patched in place at export time; the API does not recreate their branding, page geometry, styles, rubric tables, or section order.

## Source register

| Record type | Source file | SHA-256 | Source size |
|---|---|---|---:|
| Coaching and Mentoring | `01_Coaching_and_Mentoring_Template.docx` | `14A49AB172A4DACBA864C5A3AC8F8DBEBBB62C115DF860E8D32BD2950853CE66` | 339,948 bytes |
| Learning Environment Audit | `02_Elevate_Learning_Environment_Audit_Template.docx` | `61EB5C4637E2E1E32806C808601E0903769B7931471FA29736CD713AD623A97B` | 342,907 bytes |
| Learning Walk | `03_Learning_Walk_Template.docx` | `70A30B9B58855A2172A9F8CAF4D874DCCF2B8CAC05CDE38C7BA50D34D9938612` | 339,579 bytes |
| LIV Cycle 1 and 2 | `04_LIV_Cycle_1_and_2_Combined_Template.docx` | `8B156B0A0EE0C75A8EBE4CB498D447744D5B21C3C9A8619D52EAC1E4739611DC` | 343,215 bytes |
| Probationary Observation | `05_Probationary_Observation_Template.docx` | `A168710546BEDEF6B4A72318AB6E627E417FF7982E5EC38469623A54970A7B1B` | 340,664 bytes |

All sources use one A4 portrait section, Oldham College/i-Elevate header artwork, Aptos-family body typography, coloured numbered section bands, bordered data-entry tables, and fixed rubric/action grids. The source package declares one page because it was generated programmatically; Word repaginates the content when opened.

## Slot map

- Coaching: 15 tables. Session metadata is in table 2; focus in tables 4-5; current-practice rubric/evidence in tables 6-7; support and summary in tables 9-10; actions in table 12; cycle outcome/closure in tables 13-14.
- Learning Environment: 22 tables. Audit metadata is in table 1; each pillar uses a section band, rubric, and evidence table; overall findings use tables 19-20; actions use table 21.
- Learning Walk: 13 tables. Context is in table 2; themes in tables 3-4; practice rubric in table 6; findings in tables 8-9; actions in table 11; submission state in table 12.
- LIV: 37 tables. Preferences are in tables 2-3; Cycle 1 occupies tables 5-20; Cycle 2 occupies tables 22-36. Each cycle has discussion/impact, visit metadata, rubric, restricted notes, reflection, opportunities, actions, and follow-up slots.
- Probation: 19 tables. Cycle overview is in tables 2-3; discussion in tables 5-7; observation metadata/rubric in tables 9-11; reflection/opportunities in tables 13-14; actions in table 16; next observation in table 18.

The exporter fills stable table coordinates and checkbox grids, then appends a compact “Complete record detail” appendix containing every stored field not represented by a fixed template slot. This makes the export lossless while retaining the supplied layout.

## Repetition and overflow

- Rubrics retain the source rows and mark the selected descriptor.
- Action grids retain their supplied rows. If a record has more actions than the fixed grid, the additional actions appear in the appended complete-detail section.
- LIV and Probation cycle/stage data use their corresponding fixed cycle/observation slots. Additional database detail is included in the appendix.
- Long text is inserted into the existing cells with wrapping enabled. Word may repaginate the template, but no source content or branding is removed.
