import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function initials(name: string | null | undefined): string {
  // Only words that start with a letter or digit count (skips emoji and punctuation).
  const parts = (name ?? "")
    .trim()
    .split(/\s+/)
    .map((part) => Array.from(part).find((ch) => /[\p{L}\p{N}]/u.test(ch)) ?? "")
    .filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0];
  const last = parts.length > 1 ? parts[parts.length - 1] : "";
  return (first + last).toUpperCase();
}

export function randomId(): string {
  return crypto.randomUUID();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
