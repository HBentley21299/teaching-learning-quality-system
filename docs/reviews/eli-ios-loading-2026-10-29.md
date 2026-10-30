# ELI loading and iOS-inspired finish — 29 October 2026

ELI now has a clean rounded head without the head star. A four-frame typing sequence provides page and section loading feedback. Small directory and field lookups use a quieter inline label and dots. The interface keeps teal and adds softer grouped panels, inset segmented choices, rounded controls, restrained shadows and press feedback.

The shared `LoadingState` is mounted while actual requests are pending. There are no artificial waits, progress percentages, timers or additional API calls. Existing rows remain available during refresh where the workflow already supports that. Errors remain errors; empty messages appear only after loading completes. The animation is decorative and hidden from assistive technology, with a single polite status label. Both the device reduced-motion preference and the in-app setting stop the sprite and dots.

Integration covers startup and route fallbacks; profile and team loading; dashboard reports and the data explorer; QA Hub and administration; LIV, probation, coaching, ELI and UCO workflows; shared form workspaces and action-theme/owner lookups. Saving controls retain their existing busy feedback.

The presentation layer is documented in [product-ios-2026-10-29.md](product-ios-2026-10-29.md). Reporting and administration loading boundaries are documented in [eli-loading-reporting-admin-2026-10-29.md](eli-loading-reporting-admin-2026-10-29.md).

## Asset and generation

- Project asset: `apps/web/public/system-assets/eli/eli-loading-typing.png`.
- Built-in image-generation tool, followed by a targeted edit removing the head star; no fallback CLI or API key was used.
- Final edit prompt specification: retain ELI's teal and charcoal identity, body, laptop, typing action and four consistently aligned frames; replace the angular star-shaped head with a simple rounded rectangular robot head and friendly cyan eyes; remove all star points or head attachments; preserve the transparent background and other details.
- Selected generated source: `C:\Users\Harry\.codex\generated_images\01a18820-8b0b-7fd2-9e27-5a04e326e52b\exec-3661946f-debc-47a0-b399-513b8ae5408f.png`.
- Actual sheet: 2172 × 724 RGBA PNG, four 543 × 724 frames, 806,238 bytes. CSS uses four discrete frame positions and aligns the character within a square artwork area.

## Verification

- Full frontend suite: **298 passed, 0 failed or skipped**. Includes deferred-request loading/error boundaries, retained results, shared controls, motion preferences and colour contrast checks. Log: `.localappdata/local-run/ios-tests-final.log`.
- `npm run build` in `apps/web`: passed real TypeScript project build (`tsc -b`) and Vite production build. Vite retains its existing main-chunk size advisory.
- `git diff --check`: passed, with existing line-ending notices.
- Native browser checks: light and dark loading artwork; page, section and inline layouts; 320px section/inline reflow with Larger text; stronger contrast; reduced-motion computed animation `none`; restored-motion animation `eli-loading-type`; three desktop segmented choices sharing one row. Preview Home and loader showed no browser console errors. Actual Dashboard navigation displayed its contextual loading status.
- The development-only fixture at `apps/web/tests/loading-preview.html` uses the actual component and display preferences, is explicitly labelled as a design review, and loads no application records. Its text/entry is absent from production output.
- Screenshots: `.localappdata/local-run/product-review/eli-loading.png`, `eli-loading-mobile.png`, and `ios-home.png`.

No database, permissions, deployment or remote repository changes were required for this finish.
