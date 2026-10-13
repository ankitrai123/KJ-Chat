"use client";

import { Users } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/misc";
import { useSignedUrl } from "@/hooks/use-signed-url";
import { cn, initials } from "@/lib/utils";

const SIZES = {
  xs: "size-6 text-[10px]",
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-12 text-base",
  xl: "size-20 text-xl",
  "2xl": "size-28 text-3xl",
} as const;

export function UserAvatar({
  name,
  path,
  size = "md",
  online,
  isGroup,
  className,
}: {
  name: string | null | undefined;
  path: string | null | undefined;
  size?: keyof typeof SIZES;
  online?: boolean;
  isGroup?: boolean;
  className?: string;
}) {
  const { url } = useSignedUrl("avatars", path);
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <Avatar className={SIZES[size]}>
        {url && <AvatarImage src={url} alt="" />}
        <AvatarFallback className="bg-accent text-accent-foreground">
          {isGroup && !name ? <Users className="size-1/2" aria-hidden /> : initials(name)}
        </AvatarFallback>
      </Avatar>
      {online && (
        <span
          className="absolute right-0 bottom-0 block size-3 rounded-full bg-online ring-2 ring-background"
          aria-label="Online"
          role="img"
        />
      )}
    </span>
  );
}
