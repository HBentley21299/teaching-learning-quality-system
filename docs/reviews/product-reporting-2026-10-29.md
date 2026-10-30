# Reporting experience review

The review covered `Dashboard`, `UcoTlaDashboard`, `DashboardDataExplorer`, `QaDashboardDataExplorer`, and `EliSubmissionBreakdown`. Dashboard navigation, source access, exports and the request cache remain shared with the existing reporting implementation.

## Concrete changes

- Report headers use plain language and an honest ready/loading/unavailable status. The cached dataset no longer calls itself live.
- Faculty/team filters stay visible. Date, status, theme and delivery filters are grouped in a native More filters disclosure with an active count. All previous filter fields and choices remain available.
- Reversed date ranges show a specific correction message. Results and export controls remain hidden until a valid range is chosen or dates are cleared.
- Metrics use semantic label/value pairs. Reporting surfaces are calm and typography is consistent with the shared interface; the previous decorative briefing gradients and tiny upper-case annotations are removed from the current presentation.
- Trend charts have numeric grid marks, a bounded date axis and a View chart data disclosure containing every exact value. Keyboard and touch users can inspect the data without hovering a dot. Monthly trends retain the complete returned year rather than dropping the first two months after ten periods.
- Zero-count bars have zero width. Empty donut datasets do not divide by zero.
- Custom form, status, related-data and outcome tables use the same measured keyboard-scroll region as the shared DataTable.
- Record expanders retain an existing controlled target while closed; saved answers are unmounted when collapsed. Empty field-filter results explain which filters can be changed and offer local recovery without clearing the report scope.
- The column chooser supports Escape and restores focus to its disclosure. Narrow layouts release wide sticky title columns and use one-column expanded-answer groups.
- UCO stage buttons expose their selected state, retain counts for other stages and toggle back to all stages when selected again. The annual staff-coverage denominator stays annual. The attention preview now identifies its five-item limit; the complete review register remains available.
- UCO people/session filters are grouped separately from the always-visible register search/sort. ELI submission coverage includes clear staff-filter recovery and distinct submitted/not-submitted status treatments.
- QA inherits the same improved explorer while retaining its review-specific bulk loader, exclusions and evidence access checks.
- The native 320px review exposed historical column styles reusing desktop width bases as heights and wrapping filter descriptions into overflowing columns. Responsive reporting now explicitly sets each axis, uses content-sized mobile heading bases, and keeps the dashboard select beside its compact search control.
- Outcome drill-down summaries no longer impose wide fixed minimum tracks that silently clip Secure+ and Mean. Narrow layouts put the title and distribution above three individually labelled metrics; long configured titles wrap. The expanded exact-data table retains its named keyboard-scroll region.

## Verification

52 targeted tests passed across `product-reporting-experience`, `dashboard-data-explorer`, `dashboard-switching`, and `uco-dashboard-state`. New checks exercise invalid-date recovery, UCO stage toggles, local field-filter recovery, column-chooser Escape/focus restoration, persistent expansion targets, all twelve monthly periods, all 31 daily exact values, zero counts, semantic metrics, and sparse summary rendering for eleven process variants. Existing request-cache, account/year scope, historical choices and report-source tests remain passing in that set.

TypeScript passed and the new stylesheet parsed without syntax errors. The coordinating review owns the native visual/viewport verification and complete test run; component/token checks alone do not establish whole-product usability.

Eight additional responsive cascade checks exercise the actual imported styles at 320, 680, 760, 800 and 1024px, including the historical stylesheets and their selector specificity. They prevent the tall heading gap, overflowing filter-description column, full-row icon-only chooser control and clipped outcome metrics identified in native review. An additional component check verifies that the three outcome metric labels and their exact values remain associated in the rendered disclosure.
