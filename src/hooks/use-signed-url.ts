"use client";

import { useEffect, useState } from "react";
import { type Bucket, getCachedSignedUrl, requestSignedUrl } from "@/lib/storage/signed-urls";

export function useSignedUrl(bucket: Bucket, path: string | null | undefined) {
  const [state, setState] = useState<{ path: string | null | undefined; url: string | null; failed: boolean }>(() => ({
    path,
    url: path ? getCachedSignedUrl(bucket, path) : null,
    failed: false,
  }));

  // Reset synchronously when the path changes (render-phase update pattern).
  if (state.path !== path) {
    setState({ path, url: path ? getCachedSignedUrl(bucket, path) : null, failed: false });
  }

  useEffect(() => {
    if (!path || state.url) return;
    let cancelled = false;
    void requestSignedUrl(bucket, path).then((url) => {
      if (!cancelled) setState({ path, url, failed: url === null });
    });
    return () => {
      cancelled = true;
    };
  }, [bucket, path, state.url]);

  return { url: state.path === path ? state.url : null, failed: state.failed };
}
