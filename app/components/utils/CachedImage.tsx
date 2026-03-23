"use client";

import { CSSProperties, ImgHTMLAttributes, SyntheticEvent, useEffect, useMemo, useState } from "react";
import { imageCache, getImageUrlFromCache } from "@/app/lib/imageCache";

type CachedImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  signedUrl: string | null;
  imageId: string | null;
};

export default function CachedImage({ signedUrl, imageId, ...imgProps }: CachedImageProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

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

  const resolvedSrc = useMemo(
    () => src ?? (imageId ? getImageUrlFromCache(imageId) : undefined),
    [imageId, src],
  );

  useEffect(() => {
    setIsLoaded(false);
  }, [resolvedSrc]);

  const handleLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    setIsLoaded(true);
    imgProps.onLoad?.(event);
  };

  const handleError = (event: SyntheticEvent<HTMLImageElement>) => {
    setIsLoaded(true);
    imgProps.onError?.(event);
  };

  const imageStyle: CSSProperties = {
    ...imgProps.style,
    opacity: isLoaded ? 1 : 0,
    transition: "opacity 240ms ease-out",
  };

  if (resolvedSrc) {
    return (
      <img
        {...imgProps}
        src={resolvedSrc}
        onLoad={handleLoad}
        onError={handleError}
        style={imageStyle}
      />
    )
  }

  return (
    <>
      <style>{`
        @keyframes cached-image-pulse {
          0% { opacity: 0.0; }
          50% { opacity: 0.45; }
          100% { opacity: 0.0; }
        }
      `}</style>
      <span
        style={{
          position: "relative",
          display: "inline-block",
          overflow: "hidden",
          lineHeight: 0,
        }}
      >
        {!isLoaded && (resolvedSrc || signedUrl || imageId) && (
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              backgroundColor: "#dfe3e8",
              animation: "cached-image-pulse 1.1s ease-in-out infinite",
            }}
          />
        )}
      </span>
    </>
  );
}
