## Plan

Add the provided Google tag (gtag.js) for Google Ads conversion tracking (`AW-18166385826`) into the `<head>` of `index.html`, right after the existing `google-site-verification` meta tag.

### Files
- `index.html` — insert `<script async src="https://www.googletagmanager.com/gtag/js?id=AW-18166385826"></script>` and the inline `gtag` init script into `<head>`.

### Acceptance criteria
- Tag loads asynchronously in the `<head>`.
- `window.dataLayer` and `gtag` function are initialized.
- Conversion ID `AW-18166385826` is configured.