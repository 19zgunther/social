"use client";

import { ImgHTMLAttributes, useEffect, useState } from "react";
import { imageCache, getImageUrlFromCache } from "@/app/lib/imageCache";

type CachedImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  signedUrl: string | null;
  imageId: string | null;
};

export default function CachedImage({ signedUrl, imageId, ...imgProps }: CachedImageProps) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;
    let objectUrlToRevoke: string | null = null;

    const load = async () => {
      const resolvedUrl = await imageCache(signedUrl, imageId);
      if (isCancelled) {
        return;
      }

      setSrc(resolvedUrl);
      if (resolvedUrl?.startsWith("blob:")) {
        objectUrlToRevoke = resolvedUrl;
      }
    };

    void load();

    return () => { isCancelled = true; };
  }, [imageId, signedUrl]);

  return <img src={src ?? (imageId ? getImageUrlFromCache(imageId) : undefined)} {...imgProps} />;
}
