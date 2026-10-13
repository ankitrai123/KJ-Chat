"use client";

import { Fragment, useMemo } from "react";
import { isEmojiOnly, tokenizeMessage } from "@/lib/chat/format";
import { cn } from "@/lib/utils";

/** Renders message text as React nodes (never HTML): links are restricted to http(s)/mailto. */
export function MessageContent({
  content,
  isMentionable,
  className,
}: {
  content: string;
  isMentionable?: (username: string) => boolean;
  className?: string;
}) {
  const tokens = useMemo(() => tokenizeMessage(content, isMentionable), [content, isMentionable]);
  const emojiOnly = isEmojiOnly(content);

  return (
    <p className={cn("break-words whitespace-pre-wrap", emojiOnly ? "text-4xl leading-tight" : "text-[0.94rem] leading-relaxed", className)}>
      {tokens.map((token, i) => {
        if (token.type === "link") {
          return (
            <a
              key={i}
              href={token.href}
              target="_blank"
              rel="noopener noreferrer nofollow ugc"
              className="break-all text-primary underline underline-offset-2"
            >
              {token.value}
            </a>
          );
        }
        if (token.type === "mention") {
          return (
            <span key={i} className="rounded bg-mention/10 px-0.5 font-medium text-mention">
              {token.value}
            </span>
          );
        }
        return <Fragment key={i}>{token.value}</Fragment>;
      })}
    </p>
  );
}
