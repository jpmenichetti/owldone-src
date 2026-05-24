## Fix: Validate contentType on image uploads

The `uploadImage` handler in `supabase/functions/images-api/index.ts` currently accepts an arbitrary `contentType` string from the client and forwards it verbatim to Supabase Storage. Magic-byte validation ensures the bytes are a real image, but the stored MIME type can still be spoofed (e.g. `text/html`, `application/javascript`), which can affect how the file is served later via signed URLs.

### Approach

Derive the stored `contentType` from the magic bytes we already inspect, ignoring whatever the client sends.

1. Extend `isValidImageBytes` (or add a sibling helper `detectImageMime`) that returns one of `"image/jpeg" | "image/png" | "image/gif" | "image/webp" | null` based on the same signature checks already in place.
2. In `uploadImage`:
   - Call `detectImageMime(bytes)`. If `null` → return `400 { error: "Invalid image file..." }` (replaces the current `isValidImageBytes` check).
   - Use the detected MIME for both:
     - `db.storage.from("todo-images").upload(path, bytes, { contentType: detected })`
     - The file extension sanity (keep current `sanitizeFileName(fileName)`; no need to rewrite extension).
   - Stop reading `contentType` from `params`. The client value is discarded.
3. Keep `todo_images` row insert unchanged (it doesn't store MIME).

### Files to change

- `supabase/functions/images-api/index.ts` — add `detectImageMime`, update `uploadImage`.
- `supabase/functions/images-api/index.test.ts` — update existing upload tests to reflect that `contentType` param is ignored; add a test asserting the storage upload receives the detected MIME even when the client sends a spoofed one (e.g. client sends `text/html` but bytes are PNG → stored as `image/png`).

No DB migration, no config change, no frontend change required (the frontend may keep sending `contentType`; it's simply ignored server-side).

### Verification

- Run `test_edge_functions` for `images-api`.
- Deploy `images-api`.
- Mark `upload_contenttype_unvalidated` as fixed.
