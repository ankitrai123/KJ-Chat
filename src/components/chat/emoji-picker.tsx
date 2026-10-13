"use client";

import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { Skeleton } from "@/components/ui/misc";

// The picker and its emoji dataset are large; load them only when first opened.
const Picker = dynamic(() => import("emoji-picker-react"), {
  ssr: false,
  loading: () => <Skeleton className="h-[380px] w-[320px]" />,
});

export function EmojiPicker({ onSelect }: { onSelect: (emoji: string) => void }) {
  const { resolvedTheme } = useTheme();
  return (
    <Picker
      onEmojiClick={(data) => onSelect(data.emoji)}
      emojiStyle="native"
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      lazyLoadEmojis
      width={320}
      height={380}
      previewConfig={{ showPreview: false }}
      searchPlaceholder="Search emoji"
      autoFocusSearch
    />
  );
}

export const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;
