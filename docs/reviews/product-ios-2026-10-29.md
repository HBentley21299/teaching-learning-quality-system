# iOS-inspired interface finish

`apps/web/src/app/product-ios.css` is a presentation-only layer, intended after the existing product and display-preference styles. It retains the app's teal identity, existing layout and native control behaviour.

The layer introduces softer continuous-feeling corner sizes, grouped surfaces, inset segmented choices, restrained card depth and near-opaque frosted shell chrome with a solid fallback. Home receives a larger greeting, rounded icon wells and more legible destination labels. Forms retain visible boundaries and native choice/date affordances. Tables, administration settings, menus and dialogs use the same material and corner language.

Press feedback uses a small temporary scale. Both the device and personal reduced-motion preferences disable that movement; the existing foundation's important duration limits remain authoritative. High contrast uses solid surfaces without decorative shadows or blur. Windows forced colours retain their system palette and existing keyboard focus.

Seven focused checks measure the actual colour tokens across light, dark, device-dark and high-contrast modes. They cover grouped/pressed surfaces, controls, icons, and the worst-case light/dark content behind translucent chrome; verify opaque high-contrast/system-colour fallbacks; and check motion/focus preservation. The responsive and personal text-size checks remain passing. Native screenshots and viewport verification belong to the coordinating review; source checks alone do not establish complete rendered accessibility.

Loading illustrations and their animation live in the separate loading-state component and stylesheet owned by the coordinating implementation.
