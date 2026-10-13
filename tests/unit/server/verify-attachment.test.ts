// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyAttachment } from "@/lib/attachments/verify.server";
import type { AdminSupabase } from "@/lib/supabase/admin";

const CONV = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const OBJ = "33333333-3333-4333-8333-333333333333";

// Real file signatures (first bytes) for content sniffing.
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
const PDF = new TextEncoder().encode("%PDF-1.7\n%âãÏÓ\n1 0 obj\n<< /Type /Catalog >>\nendobj\n");
const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0xff, 0xff, 0x00, 0x00]);

function fakeAdmin(size: number | null): AdminSupabase {
  const bucket = {
    info: vi.fn(async () => (size === null ? { data: null, error: { message: "not found" } } : { data: { size }, error: null })),
    createSignedUrl: vi.fn(async () => ({ data: { signedUrl: "https://storage.example/signed" }, error: null })),
  };
  return { storage: { from: () => bucket } } as unknown as AdminSupabase;
}

function serve(bytes: Uint8Array) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Blob([new Uint8Array(bytes)]), { status: 206 })),
  );
}

const input = (fileName: string, mimeType: string, kind: "image" | "file" | "voice" = "file") => ({
  path: `${CONV}/${USER}/${OBJ}/${fileName}`,
  fileName,
  mimeType,
  size: 999,
  kind,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("verifyAttachment", () => {
  it("accepts a real PNG and reports the stored (not claimed) size", async () => {
    serve(PNG);
    const result = await verifyAttachment(fakeAdmin(4321), input("a.png", "image/png", "image"), { conversationId: CONV, userId: USER });
    expect(result).toMatchObject({ mime_type: "image/png", file_size: 4321, kind: "image" });
  });

  it("accepts a real PDF", async () => {
    serve(PDF);
    await expect(verifyAttachment(fakeAdmin(100), input("doc.pdf", "application/pdf"), { conversationId: CONV, userId: USER })).resolves.toBeTruthy();
  });

  it("rejects an executable renamed to .pdf", async () => {
    serve(EXE);
    await expect(verifyAttachment(fakeAdmin(100), input("invoice.pdf", "application/pdf"), { conversationId: CONV, userId: USER })).rejects.toThrow(
      /don't match/,
    );
  });

  it("rejects binary content declared as text", async () => {
    serve(EXE);
    await expect(verifyAttachment(fakeAdmin(100), input("notes.txt", "text/plain"), { conversationId: CONV, userId: USER })).rejects.toThrow(/text/);
  });

  it("rejects objects in someone else's folder or another conversation", async () => {
    serve(PNG);
    const other = "44444444-4444-4444-8444-444444444444";
    await expect(verifyAttachment(fakeAdmin(10), input("a.png", "image/png", "image"), { conversationId: CONV, userId: other })).rejects.toThrow(/belong/);
    await expect(verifyAttachment(fakeAdmin(10), input("a.png", "image/png", "image"), { conversationId: other, userId: USER })).rejects.toThrow(/belong/);
  });

  it("rejects disallowed types, missing uploads and oversized files", async () => {
    serve(PNG);
    await expect(verifyAttachment(fakeAdmin(10), input("page.html", "text/html"), { conversationId: CONV, userId: USER })).rejects.toThrow(/isn't allowed/);
    await expect(verifyAttachment(fakeAdmin(null), input("a.png", "image/png", "image"), { conversationId: CONV, userId: USER })).rejects.toThrow(/uploading/);
    await expect(verifyAttachment(fakeAdmin(200 * 1024 * 1024), input("a.png", "image/png", "image"), { conversationId: CONV, userId: USER })).rejects.toThrow(
      /too large/,
    );
  });

  it("requires voice notes to be audio", async () => {
    serve(PNG);
    await expect(verifyAttachment(fakeAdmin(10), input("v.png", "image/png", "voice"), { conversationId: CONV, userId: USER })).rejects.toThrow(/audio/);
  });
});
