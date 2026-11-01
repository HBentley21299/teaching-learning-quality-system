# QA Hub review navigation

The QA Hub homepage opens on Live reviews, containing open and reopened reviews. Saved lifecycle status determines availability; the closing date does not turn a review into a closed review automatically.

Prominent Live reviews and Closed reviews buttons show counts from the user's permitted review list. Drafts appear separately for managers or anyone with visible drafts; All reviews remains available. Existing search, academic-year, owner and sorting controls apply to the selected view and remain set when changing views. The heading reports the number shown against that view's permitted total.

Live review cards open evidence collection. Closed review cards open findings and reports, while drafts retain their existing setup route. An empty Live view says no live reviews are available and offers a shortcut to Closed reviews when historical reviews exist. No review data, permissions or lifecycle rules are changed.

Verification passed all 475 frontend checks with no skips and the production web build. The actual component was checked in an isolated browser fixture with open, reopened, closed and draft reviews: default grouping, navigation, retained filters, visible keyboard focus and 390-pixel mobile layout passed without browser errors or horizontal overflow. Read-only checks confirmed the running local web app serves the updated homepage and stylesheet. This is a frontend-only change; no database update, API restart, remote repository write or deployment was needed. The existing main-bundle size advisory remains.
