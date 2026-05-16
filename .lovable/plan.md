## Add anchors to Features and Smart Lifecycle Rules

Add scroll anchors to the two main marketing sections on the login page so they can be linked directly (e.g. `/#features`, `/#lifecycle`).

### Changes

**`src/components/LoginPage.tsx`**
- Add `id="features"` to the Features section wrapper (the `<div>` containing "Everything you need" heading + feature cards grid).
- Add `id="lifecycle"` to the Smart Lifecycle Rules card wrapper.
- Add `scroll-mt-20` on both so the sticky-ish top spacing doesn't clip the heading when jumped to.

### Out of scope
- No new nav links, no smooth-scroll behavior changes, no translation updates.
- No anchors on individual feature cards or sub-rules (Overdue / Transitions) — can be added later if needed.

### Open question
Would you also like in-page nav links (e.g. a small "Features · Lifecycle" bar near the top of the login page) pointing to these anchors, or just the raw `#features` / `#lifecycle` targets for external linking (Google Ads, etc.)?
