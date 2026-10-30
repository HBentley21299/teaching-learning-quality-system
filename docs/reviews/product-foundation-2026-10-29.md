# Product interface foundation

Scope: the shared visual language and basic design-system components. This is one part of the wider product review; it does not claim every application workflow has passed accessibility or usability testing.

## Findings addressed

- The existing theme animated every route, raised noninteractive panels and metrics on hover, and used several decorative gradients. The foundation now uses stable surfaces and restrained interaction feedback.
- The same form was using uppercase 11px labels alongside larger mixed-case labels. Shared form/filter labels and table headings now use sentence case, consistent weight and readable sizing.
- Buttons, pagination controls and selectors had different minimum heights. Comfortable controls now use 44px targets; an explicitly chosen compact setting changes spacing independently of text size. Coarse-pointer devices retain the comfortable control height.
- Focus styling depended on a translucent shadow and was missing from some native disclosure controls. Interactive elements now have a visible solid outline, including Windows forced-colour support.
- Strong form borders were below a 3:1 contrast ratio against the control surface. The shared border token was corrected and the contrast is measured by a regression test.
- Metrics were unassociated spans and strong text. Shared metrics now use description-list pairs so the label and value have a semantic relationship.
- The shared Button accepted only a narrow subset of native attributes. It now preserves native form/keyboard/description/ref attributes and has an explicit busy state that blocks duplicate native activation while retaining its label.
- Active role, login, My Team and Probation labels that were fixed in pixels now scale with the personal text-size setting. My Team filters and probation rating choices reflow with available space rather than reserving fixed-width text columns. The year and account controls use the same scalable target height as other controls.
- Required markers in form labels, rubric legends, onboarding and QA, and legacy inline errors now use the theme-aware danger foreground. This corrects the dark-mode Work Scrutiny marker confirmed during native review; its previous fixed dark-red text did not remain readable on the dark form surface.

## Shared states and preferences

`apps/web/src/app/product-polish.css` is loaded after the historical module styles. It provides:

- Light/dark and high-contrast surfaces, legible muted text, accessible primary-action text and distinct keyboard focus.
- Comfortable/compact spacing, standard/large/larger text, spacious reading, optional underlined links and reduced motion through the preference data attributes on the document root.
- Consistent tables, overflow focus, empty states, native dialogs, collapse sections and staff/course/room choice popovers.
- Local success/error feedback, field errors and linked error summaries, plus progressive filter layouts with visible active-filter counts.
- Narrow-screen layouts, viewport-safe dialogs, coarse-pointer targets, reduced-motion and Windows forced-colour rules, and printable tables with repeating headers.

## Validation

`node --test tests/product-foundation.test.mjs` passes nine tests covering native button semantics, busy controls, metric relationships, measured contrast of normal text, secondary text, primary buttons, form boundaries and focus against the shared light/dark/high-contrast surfaces, Windows forced-colour focus overriding high-contrast theme preferences, and required/error foregrounds on all four form-surface variants.

`node --test tests/product-text-scaling.test.mjs` audits the actual imported stylesheet order against active TSX classes. It checks that historical fixed-pixel labels have scalable replacements and that header controls follow the common height. Native 200% viewport and Larger-text verification remains part of the coordinating visual review; a source cascade test alone does not prove all rendered layouts.

The contrast tests measure shared tokens. They do not by themselves prove the contrast or semantic accessibility of every module-specific rendering. Whole-product runtime verification belongs to the coordinating review.
