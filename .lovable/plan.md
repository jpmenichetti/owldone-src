

## Fix Snyk Vulnerabilities

### Changes

1. **Upgrade `react-router-dom`** in `package.json` from `^6.30.1` to `^6.30.2` — fixes CVE-2025-68470 (open redirect).

2. **Pin lodash resolution** — add an `overrides` field in `package.json` to force transitive lodash to `>=4.17.23`, fixing CVE-2025-13465:
   ```json
   "overrides": {
     "lodash": ">=4.17.23"
   }
   ```

3. **CVE-2026-22029** — no action needed, it only affects React Router v7 which this project does not use. If Snyk still flags it, it can be marked as "not applicable."

### Files Modified
- `package.json`

