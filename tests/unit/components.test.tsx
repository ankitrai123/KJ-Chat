import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MessageContent } from "@/components/chat/message-content";
import { ReadStatus } from "@/components/chat/read-status";
import { UploadTray } from "@/components/chat/upload-tray";
import type { UploadItem } from "@/hooks/use-uploads";
import userEvent from "@testing-library/user-event";

describe("MessageContent", () => {
  it("renders markup as inert text", () => {
    const { container } = render(<MessageContent content={'<img src=x onerror="alert(1)"><script>alert(2)</script>'} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<script>alert(2)</script>");
  });

  it("links safe URLs with hardened rel attributes and never javascript: URLs", () => {
    render(<MessageContent content="visit https://example.com or javascript:alert(1)" />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "https://example.com/");
    expect(links[0]).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(links[0]).toHaveAttribute("target", "_blank");
  });

  it("highlights mentions of known members only", () => {
    render(<MessageContent content="hey @ana and @zed" isMentionable={(u) => u === "ana"} />);
    expect(screen.getByText("@ana")).toHaveClass("text-mention");
    expect(screen.queryByText("@zed")).toBeNull();
  });
});

describe("ReadStatus", () => {
  it.each([
    ["pending", "Sending"],
    ["sent", "Sent"],
    ["delivered", "Delivered"],
    ["read", "Read"],
    ["failed", "Not sent"],
  ] as const)("labels %s ticks accessibly", (state, label) => {
    render(<ReadStatus state={state} />);
    expect(screen.getByRole("img", { name: label })).toBeInTheDocument();
  });
});

describe("UploadTray", () => {
  const item = (patch: Partial<UploadItem>): UploadItem => ({
    id: "1",
    file: new File(["x"], "photo.png", { type: "image/png" }),
    path: "p",
    mimeType: "image/png",
    kind: "image",
    progress: 0.42,
    status: "uploading",
    meta: {},
    ...patch,
  });

  it("shows progress and lets the user cancel", async () => {
    const onRemove = vi.fn();
    render(<UploadTray items={[item({})]} onRemove={onRemove} onRetry={vi.fn()} />);
    expect(screen.getByText("42%")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /cancel upload of photo.png/i }));
    expect(onRemove).toHaveBeenCalledWith("1");
  });

  it("offers retry after a failure", async () => {
    const onRetry = vi.fn();
    render(<UploadTray items={[item({ status: "error", error: "Upload failed" })]} onRemove={vi.fn()} onRetry={onRetry} />);
    await userEvent.click(screen.getByRole("button", { name: /retry uploading photo.png/i }));
    expect(onRetry).toHaveBeenCalledWith("1");
  });
});
