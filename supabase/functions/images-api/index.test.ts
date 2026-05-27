import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

import {
  detectImageMime,
  isValidImageBytes,
  sanitizeFileName,
  uploadImage,
  deleteImage,
  getImageUrl,
} from "./index.ts";

const USER_ID = "user-123";
const TODO_ID = "todo-1";

// ---------- magic byte detection ----------

Deno.test("detectImageMime: JPEG header", () => {
  assertEquals(detectImageMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
});
Deno.test("detectImageMime: PNG header", () => {
  assertEquals(
    detectImageMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    "image/png",
  );
});
Deno.test("detectImageMime: GIF header", () => {
  assertEquals(detectImageMime(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])), "image/gif");
});
Deno.test("detectImageMime: WEBP header", () => {
  const webp = new Uint8Array(20);
  webp.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  webp.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  assertEquals(detectImageMime(webp), "image/webp");
});
Deno.test("detectImageMime: text/html-like bytes return null", () => {
  // "<!DOCTYPE" — a classic polyglot attempt
  assertEquals(detectImageMime(new TextEncoder().encode("<!DOCTYPE")), null);
});
Deno.test("detectImageMime: empty buffer returns null", () => {
  assertEquals(detectImageMime(new Uint8Array(0)), null);
});
Deno.test("isValidImageBytes returns false for non-image", () => {
  assertEquals(isValidImageBytes(new TextEncoder().encode("notanimage")), false);
});

// ---------- filename sanitisation ----------

Deno.test("sanitizeFileName: strips path separators", () => {
  assertEquals(sanitizeFileName("../../etc/passwd"), "_._.._etc_passwd");
});
Deno.test("sanitizeFileName: collapses repeated dots", () => {
  assertEquals(sanitizeFileName("evil..jpg"), "evil.jpg");
});
Deno.test("sanitizeFileName: keeps allowed chars", () => {
  assertEquals(sanitizeFileName("My-Photo_2026.jpg"), "My-Photo_2026.jpg");
});
Deno.test("sanitizeFileName: replaces spaces and unicode", () => {
  assertEquals(sanitizeFileName("photo café.png"), "photo_caf__.png");
});

// ---------- uploadImage ----------

function makeJpegBytes(size = 32) {
  const arr = new Uint8Array(size);
  arr[0] = 0xff;
  arr[1] = 0xd8;
  arr[2] = 0xff;
  return arr;
}

function buildUploadMockDb(opts: {
  todo?: any;
  uploadError?: any;
  insertError?: any;
} = {}) {
  const calls: { kind: string; payload?: any }[] = [];
  const db: any = {
    from(table: string) {
      if (table === "todos") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => {
                  calls.push({ kind: "select-todo" });
                  return { data: opts.todo === undefined ? { id: TODO_ID } : opts.todo, error: null };
                },
              }),
            }),
          }),
        };
      }
      if (table === "todo_images") {
        return {
          insert: async (row: any) => {
            calls.push({ kind: "insert-image", payload: row });
            return { error: opts.insertError ?? null };
          },
        };
      }
      return {};
    },
    storage: {
      from(_bucket: string) {
        return {
          upload: async (path: string, bytes: Uint8Array, meta: any) => {
            calls.push({ kind: "upload", payload: { path, size: bytes.length, meta } });
            return { error: opts.uploadError ?? null };
          },
        };
      },
    },
  };
  return { db, calls };
}

Deno.test("uploadImage: rejects > 10MB", async () => {
  const { db } = buildUploadMockDb();
  const bytes = makeJpegBytes(10 * 1024 * 1024 + 1);
  const res = await uploadImage({
    db,
    userId: USER_ID,
    params: { todoId: TODO_ID, fileBase64: encodeBase64(bytes), fileName: "x.jpg" },
  });
  assertEquals(res.status, 400);
});

Deno.test("uploadImage: rejects when magic bytes are not a known image", async () => {
  const { db } = buildUploadMockDb();
  const fake = new TextEncoder().encode("<svg>haha</svg>");
  const res = await uploadImage({
    db,
    userId: USER_ID,
    params: { todoId: TODO_ID, fileBase64: encodeBase64(fake), fileName: "x.svg" },
  });
  const body = JSON.parse(await res.text());
  assertEquals(res.status, 400);
  assert(String(body.error).includes("Only JPEG"));
});

Deno.test("uploadImage: returns 404 when todo not owned by user", async () => {
  const { db } = buildUploadMockDb({ todo: null });
  const res = await uploadImage({
    db,
    userId: USER_ID,
    params: { todoId: TODO_ID, fileBase64: encodeBase64(makeJpegBytes()), fileName: "x.jpg" },
  });
  assertEquals(res.status, 404);
});

Deno.test("uploadImage: success uses sanitised filename and detected mime", async () => {
  const { db, calls } = buildUploadMockDb();
  const res = await uploadImage({
    db,
    userId: USER_ID,
    params: {
      todoId: TODO_ID,
      fileBase64: encodeBase64(makeJpegBytes()),
      fileName: "../evil name.jpg",
    },
  });
  assertEquals(res.status, 200);
  const uploadCall = calls.find((c) => c.kind === "upload")!;
  assert(uploadCall.payload.path.startsWith(`${USER_ID}/${TODO_ID}/`));
  assert(!uploadCall.payload.path.includes(".."));
  assert(!uploadCall.payload.path.includes(" "));
  assertEquals(uploadCall.payload.meta.contentType, "image/jpeg");

  const insertCall = calls.find((c) => c.kind === "insert-image")!;
  assertEquals(insertCall.payload.todo_id, TODO_ID);
  assert(!insertCall.payload.file_name.includes(".."));
});

Deno.test("uploadImage: propagates storage upload error", async () => {
  const { db } = buildUploadMockDb({ uploadError: new Error("storage down") });
  let thrown: any = null;
  try {
    await uploadImage({
      db,
      userId: USER_ID,
      params: {
        todoId: TODO_ID,
        fileBase64: encodeBase64(makeJpegBytes()),
        fileName: "x.jpg",
      },
    });
  } catch (e) {
    thrown = e;
  }
  assert(thrown);
});

// ---------- deleteImage / getImageUrl ownership ----------

function buildOwnershipMockDb(opts: { img?: any; deleteError?: any; signed?: string } = {}) {
  const calls: any[] = [];
  const db: any = {
    from(table: string) {
      if (table === "todo_images") {
        // chained .select.eq.eq.eq.maybeSingle for ownership read
        const ownershipChain = {
          eq: () => ownershipChain,
          maybeSingle: async () => {
            calls.push({ kind: "ownership-read" });
            return {
              data: opts.img === undefined ? { id: "img1", storage_path: "p" } : opts.img,
              error: null,
            };
          },
        };
        return {
          select: () => ownershipChain,
          delete: () => ({
            eq: async () => {
              calls.push({ kind: "image-delete" });
              return { error: opts.deleteError ?? null };
            },
          }),
        };
      }
      return {};
    },
    storage: {
      from(_b: string) {
        return {
          remove: async (paths: string[]) => {
            calls.push({ kind: "storage-remove", payload: paths });
            return { error: null };
          },
          createSignedUrl: async (path: string, ttl: number) => {
            calls.push({ kind: "signed", payload: { path, ttl } });
            return { data: { signedUrl: opts.signed ?? "https://signed/x" }, error: null };
          },
        };
      },
    },
  };
  return { db, calls };
}

Deno.test("deleteImage: 400 when id/storagePath missing", async () => {
  const { db } = buildOwnershipMockDb();
  const res = await deleteImage({ db, userId: USER_ID, params: {} });
  assertEquals(res.status, 400);
});

Deno.test("deleteImage: 404 when image not owned by user", async () => {
  const { db } = buildOwnershipMockDb({ img: null });
  const res = await deleteImage({
    db,
    userId: USER_ID,
    params: { id: "img1", storagePath: "p" },
  });
  assertEquals(res.status, 404);
});

Deno.test("deleteImage: success removes storage and DB row", async () => {
  const { db, calls } = buildOwnershipMockDb();
  const res = await deleteImage({
    db,
    userId: USER_ID,
    params: { id: "img1", storagePath: "the/path" },
  });
  assertEquals(res.status, 200);
  assert(calls.some((c) => c.kind === "storage-remove" && c.payload[0] === "the/path"));
  assert(calls.some((c) => c.kind === "image-delete"));
});

Deno.test("getImageUrl: 400 when storagePath missing", async () => {
  const { db } = buildOwnershipMockDb();
  const res = await getImageUrl({ db, userId: USER_ID, params: {} });
  assertEquals(res.status, 400);
});

Deno.test("getImageUrl: 404 when image not owned", async () => {
  const { db } = buildOwnershipMockDb({ img: null });
  const res = await getImageUrl({
    db,
    userId: USER_ID,
    params: { storagePath: "someone/else/x" },
  });
  assertEquals(res.status, 404);
});

Deno.test("getImageUrl: returns signed URL with 1h TTL", async () => {
  const { db, calls } = buildOwnershipMockDb({ signed: "https://signed/abc" });
  const res = await getImageUrl({
    db,
    userId: USER_ID,
    params: { storagePath: "u/t/file.jpg" },
  });
  const body = JSON.parse(await res.text());
  assertEquals(res.status, 200);
  assertEquals(body.signedUrl, "https://signed/abc");
  const signCall = calls.find((c) => c.kind === "signed")!;
  assertEquals(signCall.payload.ttl, 3600);
});
