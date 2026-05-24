import {
  assertEquals,
  assert,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

import {
  uploadImage,
  deleteImage,
  getImageUrl,
  isValidImageBytes,
  sanitizeFileName,
} from "./index.ts";

// ---------- Test setup helpers ----------

const USER_ID = "user-123";
const TODO_ID = "todo-abc";

type Call = {
  table?: string;
  bucket?: string;
  op: string;
  args: any[];
  filters: Array<{ method: string; args: any[] }>;
};

type StorageHandlers = {
  upload?: (path: string, bytes: Uint8Array, opts: any) => { data?: any; error?: any };
  remove?: (paths: string[]) => { data?: any; error?: any };
  createSignedUrl?: (path: string, expires: number) => { data?: any; error?: any };
};

function buildMockDb(
  resultsByTable: Record<string, (call: Call) => { data?: any; error?: any }>,
  storageByBucket: Record<string, StorageHandlers>,
  callLog: Call[],
) {
  function makeChain(table: string, op: string, args: any[]) {
    const call: Call = { table, op, args, filters: [] };
    callLog.push(call);

    const resolver = () => {
      const handler = resultsByTable[table];
      const res = handler ? handler(call) : { data: null, error: null };
      return Promise.resolve(res);
    };

    const chain: any = {
      eq(...a: any[]) {
        call.filters.push({ method: "eq", args: a });
        return chain;
      },
      maybeSingle() {
        call.filters.push({ method: "maybeSingle", args: [] });
        return resolver();
      },
      select(...a: any[]) {
        call.filters.push({ method: "select", args: a });
        return chain;
      },
      then(onFulfilled: any, onRejected: any) {
        return resolver().then(onFulfilled, onRejected);
      },
    };
    return chain;
  }

  return {
    from(table: string) {
      return {
        select(cols: string) {
          return makeChain(table, "select", [cols]);
        },
        insert(values: any) {
          return makeChain(table, "insert", [values]);
        },
        delete() {
          return makeChain(table, "delete", []);
        },
      };
    },
    storage: {
      from(bucket: string) {
        const handlers = storageByBucket[bucket] ?? {};
        return {
          async upload(path: string, bytes: Uint8Array, opts: any) {
            callLog.push({ bucket, op: "upload", args: [path, bytes, opts], filters: [] });
            return handlers.upload ? handlers.upload(path, bytes, opts) : { data: null, error: null };
          },
          async remove(paths: string[]) {
            callLog.push({ bucket, op: "remove", args: [paths], filters: [] });
            return handlers.remove ? handlers.remove(paths) : { data: null, error: null };
          },
          async createSignedUrl(path: string, expires: number) {
            callLog.push({ bucket, op: "createSignedUrl", args: [path, expires], filters: [] });
            return handlers.createSignedUrl
              ? handlers.createSignedUrl(path, expires)
              : { data: { signedUrl: "https://example.com/x" }, error: null };
          },
        };
      },
    },
  } as any;
}

async function readJson(res: Response) {
  return JSON.parse(await res.text());
}

// Valid PNG header bytes
function pngBytes(extraSize = 0): Uint8Array {
  const header = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  const arr = new Uint8Array(header.length + extraSize);
  arr.set(header, 0);
  return arr;
}

// ---------- Pure helpers ----------

Deno.test("isValidImageBytes accepts PNG/JPEG/GIF/WEBP signatures", () => {
  assert(isValidImageBytes(new Uint8Array([0xFF, 0xD8, 0xFF, 0x00]))); // JPEG
  assert(isValidImageBytes(new Uint8Array([0x89, 0x50, 0x4E, 0x47]))); // PNG
  assert(isValidImageBytes(new Uint8Array([0x47, 0x49, 0x46, 0x38]))); // GIF
  assert(
    isValidImageBytes(
      new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
    ),
  ); // WEBP
});

Deno.test("isValidImageBytes rejects unknown bytes", () => {
  assertEquals(isValidImageBytes(new Uint8Array([0, 1, 2, 3])), false);
});

Deno.test("sanitizeFileName strips unsafe characters and collapses dots", () => {
  assertEquals(sanitizeFileName("hello world!.png"), "hello_world_.png");
  assertEquals(sanitizeFileName("../../etc/passwd"), "._._etc_passwd");
  assertEquals(sanitizeFileName("a..b...c.png"), "a.b.c.png");
});

// ---------- uploadImage ----------

Deno.test("uploadImage rejects files larger than 10MB", async () => {
  const calls: Call[] = [];
  const db = buildMockDb({}, {}, calls);
  const big = new Uint8Array(10 * 1024 * 1024 + 1);
  big.set([0x89, 0x50, 0x4E, 0x47], 0);

  const res = await uploadImage({
    db,
    userId: USER_ID,
    params: {
      todoId: TODO_ID,
      fileBase64: encodeBase64(big),
      fileName: "x.png",
      contentType: "image/png",
    },
  });
  const body = await readJson(res);
  assertEquals(res.status, 400);
  assert(body.error.includes("too large"));
});

Deno.test("uploadImage rejects invalid image signatures", async () => {
  const calls: Call[] = [];
  const db = buildMockDb({}, {}, calls);

  const res = await uploadImage({
    db,
    userId: USER_ID,
    params: {
      todoId: TODO_ID,
      fileBase64: encodeBase64(new Uint8Array([1, 2, 3, 4])),
      fileName: "x.png",
      contentType: "image/png",
    },
  });
  const body = await readJson(res);
  assertEquals(res.status, 400);
  assert(body.error.includes("Invalid image"));
});

Deno.test("uploadImage returns 404 when todo not found", async () => {
  const calls: Call[] = [];
  const db = buildMockDb(
    { todos: () => ({ data: null, error: null }) },
    {},
    calls,
  );

  const res = await uploadImage({
    db,
    userId: USER_ID,
    params: {
      todoId: TODO_ID,
      fileBase64: encodeBase64(pngBytes()),
      fileName: "x.png",
      contentType: "image/png",
    },
  });
  const body = await readJson(res);
  assertEquals(res.status, 404);
  assertEquals(body.error, "Todo not found");
});

Deno.test("uploadImage uploads to storage and inserts metadata row", async () => {
  const calls: Call[] = [];
  let uploadedPath = "";
  const db = buildMockDb(
    {
      todos: () => ({ data: { id: TODO_ID }, error: null }),
      todo_images: () => ({ data: null, error: null }),
    },
    {
      "todo-images": {
        upload: (path) => {
          uploadedPath = path;
          return { data: { path }, error: null };
        },
      },
    },
    calls,
  );

  const res = await uploadImage({
    db,
    userId: USER_ID,
    params: {
      todoId: TODO_ID,
      fileBase64: encodeBase64(pngBytes()),
      fileName: "weird name!.png",
      contentType: "image/png",
    },
  });
  const body = await readJson(res);

  assertEquals(res.status, 200);
  assertEquals(body, { success: true });
  assert(uploadedPath.startsWith(`${USER_ID}/${TODO_ID}/`));
  assert(uploadedPath.endsWith("weird_name_.png"));

  const insertCall = calls.find((c) => c.table === "todo_images" && c.op === "insert")!;
  assertEquals(insertCall.args[0].todo_id, TODO_ID);
  assertEquals(insertCall.args[0].file_name, "weird_name_.png");
  assertEquals(insertCall.args[0].storage_path, uploadedPath);
});

Deno.test("uploadImage propagates storage upload errors", async () => {
  const calls: Call[] = [];
  const db = buildMockDb(
    { todos: () => ({ data: { id: TODO_ID }, error: null }) },
    {
      "todo-images": {
        upload: () => ({ data: null, error: new Error("storage boom") }),
      },
    },
    calls,
  );

  await assertRejects(
    () =>
      uploadImage({
        db,
        userId: USER_ID,
        params: {
          todoId: TODO_ID,
          fileBase64: encodeBase64(pngBytes()),
          fileName: "x.png",
          contentType: "image/png",
        },
      }),
    Error,
    "storage boom",
  );
});

Deno.test("uploadImage propagates db insert errors", async () => {
  const calls: Call[] = [];
  const db = buildMockDb(
    {
      todos: () => ({ data: { id: TODO_ID }, error: null }),
      todo_images: () => ({ data: null, error: new Error("db boom") }),
    },
    {
      "todo-images": {
        upload: () => ({ data: null, error: null }),
      },
    },
    calls,
  );

  await assertRejects(
    () =>
      uploadImage({
        db,
        userId: USER_ID,
        params: {
          todoId: TODO_ID,
          fileBase64: encodeBase64(pngBytes()),
          fileName: "x.png",
          contentType: "image/png",
        },
      }),
    Error,
    "db boom",
  );
});

Deno.test("uploadImage ignores client contentType and stores detected MIME", async () => {
  const calls: Call[] = [];
  let uploadOpts: any = null;
  const db = buildMockDb(
    {
      todos: () => ({ data: { id: TODO_ID }, error: null }),
      todo_images: () => ({ data: null, error: null }),
    },
    {
      "todo-images": {
        upload: (_path, _bytes, opts) => {
          uploadOpts = opts;
          return { data: null, error: null };
        },
      },
    },
    calls,
  );

  const res = await uploadImage({
    db,
    userId: USER_ID,
    params: {
      todoId: TODO_ID,
      fileBase64: encodeBase64(pngBytes()),
      fileName: "x.png",
      contentType: "text/html", // spoofed
    },
  });
  assertEquals(res.status, 200);
  assertEquals(uploadOpts.contentType, "image/png");
});

// ---------- deleteImage ----------

Deno.test("deleteImage removes storage object then deletes db row", async () => {
  const calls: Call[] = [];
  const db = buildMockDb(
    { todo_images: () => ({ data: { id: "img-1", storage_path: "user-123/todo-abc/file.png" }, error: null }) },
    { "todo-images": { remove: () => ({ data: null, error: null }) } },
    calls,
  );

  const res = await deleteImage({
    db,
    userId: USER_ID,
    params: { id: "img-1", storagePath: "user-123/todo-abc/file.png" },
  });
  const body = await readJson(res);

  assertEquals(res.status, 200);
  assertEquals(body, { success: true });

  const removeCall = calls.find((c) => c.op === "remove")!;
  assertEquals(removeCall.args[0], ["user-123/todo-abc/file.png"]);

  const dbDelete = calls.find((c) => c.table === "todo_images" && c.op === "delete")!;
  assertEquals(dbDelete.filters[0], { method: "eq", args: ["id", "img-1"] });
});

Deno.test("deleteImage propagates db delete errors", async () => {
  const calls: Call[] = [];
  const db = buildMockDb(
    {
      todo_images: (call) =>
        call.op === "delete"
          ? { data: null, error: new Error("delete boom") }
          : { data: { id: "img-1", storage_path: "p" }, error: null },
    },
    { "todo-images": { remove: () => ({ data: null, error: null }) } },
    calls,
  );

  await assertRejects(
    () =>
      deleteImage({
        db,
        userId: USER_ID,
        params: { id: "img-1", storagePath: "p" },
      }),
    Error,
    "delete boom",
  );
});

// ---------- getImageUrl ----------

Deno.test("getImageUrl returns signed URL for storage path", async () => {
  const calls: Call[] = [];
  const db = buildMockDb(
    { todo_images: () => ({ data: { id: "img-1" }, error: null }) },
    {
      "todo-images": {
        createSignedUrl: (path, expires) => {
          assertEquals(expires, 3600);
          return { data: { signedUrl: `https://signed/${path}` }, error: null };
        },
      },
    },
    calls,
  );

  const res = await getImageUrl({
    db,
    userId: USER_ID,
    params: { storagePath: "user-123/todo-abc/file.png" },
  });
  const body = await readJson(res);

  assertEquals(res.status, 200);
  assertEquals(body, { signedUrl: "https://signed/user-123/todo-abc/file.png" });
});

Deno.test("getImageUrl propagates signing errors", async () => {
  const calls: Call[] = [];
  const db = buildMockDb(
    { todo_images: () => ({ data: { id: "img-1" }, error: null }) },
    { "todo-images": { createSignedUrl: () => ({ data: null, error: new Error("sign boom") }) } },
    calls,
  );

  await assertRejects(
    () =>
      getImageUrl({
        db,
        userId: USER_ID,
        params: { storagePath: "p" },
      }),
    Error,
    "sign boom",
  );
});
