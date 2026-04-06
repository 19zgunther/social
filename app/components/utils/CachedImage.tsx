"use client";

import { CSSProperties, ImgHTMLAttributes, SyntheticEvent, useEffect, useMemo, useState } from "react";
import { imageCache, getImageUrlFromCache } from "@/app/lib/imageCache";
import { globalDebugData } from "@/app/components/utils/globalDebugData";

type CachedImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  signedUrl: string | null;
  imageId: string | null;
};

function LoadingSpinner() {
  return (
    <span
      aria-hidden
      style={{
        width: 28,
        height: 28,
        border: "2.5px solid rgba(255, 255, 255, 0.22)",
        borderTopColor: "rgba(255, 255, 255, 0.92)",
        borderRadius: "50%",
        boxSizing: "border-box",
        animation: "cached-image-spin 0.65s linear infinite",
      }}
    />
  );
}

export default function CachedImage({ signedUrl, imageId, ...imgProps }: CachedImageProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [retry, setRetry] = useState(0);

  const { className, style, ...restImgProps } = imgProps;

  useEffect(() => {
    let isCancelled = false;
    let objectUrlToRevoke: string | null = null;

    const load = async () => {
      const resolvedUrl = await imageCache(signedUrl, imageId);
      if (isCancelled) {
        console.log("load cancelled");
        globalDebugData.cachedImageLoadCancelleds++;
        return;
      }

      setSrc(resolvedUrl);
      if (resolvedUrl?.startsWith("blob:")) {
        objectUrlToRevoke = resolvedUrl;
      }
    };

    void load();

    return () => { isCancelled = true; };
  }, [imageId, signedUrl, retry]);

  const resolvedSrc = useMemo(
    () => src ?? (imageId ? getImageUrlFromCache(imageId) : undefined),
    [imageId, src],
  );

  useEffect(() => {
    setIsLoaded(false);
  }, [resolvedSrc]);

  const handleLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    setIsLoaded(true);
    restImgProps.onLoad?.(event);
  };

  const handleError = (event: SyntheticEvent<HTMLImageElement>) => {
    setIsLoaded(true);
    restImgProps.onError?.(event);
  };

  const imageStyle: CSSProperties = {
    opacity: isLoaded ? 1 : 0,
    transition: "opacity 240ms ease-out",
  };

  const hasSource = Boolean(signedUrl || imageId);
  const showLoader = hasSource && !(resolvedSrc && isLoaded);

  const wrapperStyle: CSSProperties = {
    display: "grid",
    lineHeight: 0,
    ...style,
  };

  const gridCell: CSSProperties = {
    gridArea: "1 / 1",
  };

  // Auto retry...?
  useEffect(() => {
    if (showLoader) {
      const timeout = setTimeout(() => { 
        console.log("retry"); 
        globalDebugData.cachedImageLoadRetries++;
        setRetry(prev => prev + 1);
      }, 5000);
      return () => clearTimeout(timeout);
    }
  }, [showLoader])

  return (
    <>
      <style>{`
        @keyframes cached-image-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
      <span
        className={className}
        style={wrapperStyle}
        role={showLoader ? "status" : undefined}
        aria-busy={showLoader || undefined}
        aria-label={showLoader ? "Loading image" : undefined}
      >
        {resolvedSrc ? (
          <img
            {...restImgProps}
            src={resolvedSrc}
            onLoad={handleLoad}
            onError={handleError}
            className={className}
            style={{ ...gridCell, zIndex: 2, ...imageStyle }}
          />
        ) : null}
        {showLoader && (
          <span
            style={{
              ...gridCell,
              zIndex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "#000000",
            }}
          >
            <LoadingSpinner />
          </span>
        )}
      </span>
    </>
  );
}
