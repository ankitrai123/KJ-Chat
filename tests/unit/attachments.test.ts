import { describe, expect, it } from "vitest";
import {
  buildAttachmentPath,
  declaredMimeType,
  formatBytes,
  isSniffCompatible,
  kindForMimeType,
  looksLikeText,
  sanitizeFileName,
  validateAttachmentFile,
} from "@/lib/attachments/rules";

const MB = 1024 * 1024;

describe("attachment validation", () => {
  it("accepts allowed types within the size limit", () => {
    expect(validateAttachmentFile({ name: "a.png", type: "image/png", size: 1000 }, 25 * MB)).toMatchObject({ ok: true, kind: "image" });
    expect(validateAttachmentFile({ name: "a.pdf", type: "application/pdf", size: 10 }, 25 * MB)).toMatchObject({ ok: true, kind: "file" });
  });

  it("rejects disallowed types, empty and oversized files", () => {
    expect(validateAttachmentFile({ name: "x.exe", type: "application/x-msdownload", size: 10 }, 25 * MB).ok).toBe(false);
    expect(validateAttachmentFile({ name: "x.svg", type: "image/svg+xml", size: 10 }, 25 * MB).ok).toBe(false);
    expect(validateAttachmentFile({ name: "x.html", type: "text/html", size: 10 }, 25 * MB).ok).toBe(false);
    expect(validateAttachmentFile({ name: "x.png", type: "image/png", size: 0 }, 25 * MB).ok).toBe(false);
    expect(validateAttachmentFile({ name: "x.png", type: "image/png", size: 26 * MB }, 25 * MB).ok).toBe(false);
    // The bucket's hard limit wins over a misconfigured larger app limit.
    expect(validateAttachmentFile({ name: "x.mp4", type: "video/mp4", size: 60 * MB }, 100 * MB).ok).toBe(false);
  });

  it("uses the extension only when the browser gives no type", () => {
    expect(declaredMimeType({ name: "notes.docx", type: "" })).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(declaredMimeType({ name: "photo.png", type: "image/jpeg" })).toBe("image/jpeg");
    expect(declaredMimeType({ name: "voice.webm", type: "audio/webm;codecs=opus" })).toBe("audio/webm");
  });

  it("maps types to kinds", () => {
    expect(kindForMimeType("video/quicktime")).toBe("video");
    expect(kindForMimeType("audio/mp4")).toBe("audio");
    expect(kindForMimeType("application/x-sh")).toBeNull();
  });
});

describe("content sniffing compatibility", () => {
  it("accepts container-equivalent detections", () => {
    expect(isSniffCompatible("audio/webm", "video/webm")).toBe(true);
    expect(isSniffCompatible("audio/mp4", "video/mp4")).toBe(true);
    expect(isSniffCompatible("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/zip")).toBe(true);
    expect(isSniffCompatible("application/msword", "application/x-cfb")).toBe(true);
  });

  it("rejects mismatches such as an executable renamed to .pdf", () => {
    expect(isSniffCompatible("application/pdf", "application/x-msdownload")).toBe(false);
    expect(isSniffCompatible("image/png", "image/jpeg")).toBe(false);
    expect(isSniffCompatible("image/jpeg", "application/zip")).toBe(false);
  });

  it("checks text files heuristically", () => {
    expect(looksLikeText(new TextEncoder().encode("name,age\nana,30\n"))).toBe(true);
    expect(looksLikeText(new TextEncoder().encode("héllo wörld ✓"))).toBe(true);
    // Cut in the middle of a multi-byte character is still text.
    const bytes = new TextEncoder().encode("ok ✓");
    expect(looksLikeText(bytes.subarray(0, bytes.length - 1))).toBe(true);
    expect(looksLikeText(new Uint8Array([0x4d, 0x5a, 0x00, 0x01]))).toBe(false);
    expect(looksLikeText(new Uint8Array([0xff, 0xfe, 0xfd, 0x41]))).toBe(false);
  });
});

describe("storage paths", () => {
  it("sanitises file names into a safe object key", () => {
    expect(sanitizeFileName("My Photo (1).JPG")).toBe("My_Photo_1.jpg");
    expect(sanitizeFileName("../../etc/passwd")).toBe("etc_passwd");
    expect(sanitizeFileName("отчёт.pdf")).toBe("file.pdf");
    expect(sanitizeFileName("")).toBe("file");
    expect(sanitizeFileName(`${"a".repeat(300)}.txt`).length).toBeLessThanOrEqual(84);
  });

  it("builds conversation/uploader scoped paths", () => {
    const path = buildAttachmentPath(
      "11111111-1111-1111-1111-111111111111",
      "22222222-2222-2222-2222-222222222222",
      "33333333-3333-3333-3333-333333333333",
      "a b.png",
    );
    expect(path).toBe("11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222/33333333-3333-3333-3333-333333333333/a_b.png");
  });

  it("formats byte sizes", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(25 * MB)).toBe("25 MB");
  });
});
