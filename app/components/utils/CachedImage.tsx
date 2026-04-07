"use client";

import {
  CSSProperties,
  ImgHTMLAttributes,
  SyntheticEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { imageCache, getImageUrlFromCache } from "@/app/lib/imageCache";
import { globalDebugData } from "@/app/components/utils/globalDebugData";

const GIVE_UP_AFTER_RETRY = 10;

type CachedImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  signedUrl?: string | null;
  imageId: string | null;
  /** Main-bucket grant from post/profile APIs; pair with `imageStorageUserId` (path owner). */
  imageAccessGrant?: string | null;
  imageStorageUserId?: string | null;
  /** Thread-bucket grant; pair with `imageThreadId` (`thread/{threadId}/{imageId}`). */
  imageThreadId?: string | null;
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

export default function CachedImage({
  signedUrl = null,
  imageId,
  imageAccessGrant = null,
  imageStorageUserId = null,
  imageThreadId = null,
  ...imgProps
}: CachedImageProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [retry, setRetry] = useState(0);
  const [giveUp, setGiveUp] = useState(false);

  const grantRef = useRef<string | null>(null);
  grantRef.current = imageAccessGrant ?? null;
  const threadIdRef = useRef<string | null>(null);
  threadIdRef.current = imageThreadId ?? null;

  const { className, style, ...restImgProps } = imgProps;

  useEffect(() => {
    setRetry(0);
    setGiveUp(false);
  }, [imageId, signedUrl, imageAccessGrant, imageStorageUserId, imageThreadId]);

  const isDismounted = useRef(false);
  useEffect(() => {
    isDismounted.current = false;
    return () => { isDismounted.current = true; };
  }, [])

  useEffect(() => {
    // Early return if the image is already cached
    if (src || (imageId && getImageUrlFromCache(imageId))) {
      return;
    }

    const load = async () => {
      const resolvedUrl = await imageCache({
        signedUrl: signedUrl ?? null,
        imageId: imageId,
        grant: grantRef.current,
        storageUserId: imageStorageUserId,
        threadId: threadIdRef.current,
      });

      // If the component is dismounted, don't set the src
      if (isDismounted.current) {
        console.log("load cancelled - comp dismounted");
        globalDebugData.cachedImageLoadCancelleds++;
        return;
      }

      // If the resolved url is null, set the give up flag
      setSrc(resolvedUrl);
      if (!resolvedUrl && retry >= GIVE_UP_AFTER_RETRY) {
        console.log("give up", imageId);
        setGiveUp(true);
      }
    };
    load();
  }, [imageId, signedUrl, imageStorageUserId, retry, src]);

  const resolvedSrc = src ?? (imageId ? getImageUrlFromCache(imageId) : null);

  const handleLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    setIsLoaded(true);
    restImgProps.onLoad?.(event);
  };

  const handleError = (event: SyntheticEvent<HTMLImageElement>) => {
    setIsLoaded(true);
    restImgProps.onError?.(event);
  };

  const imageStyle: CSSProperties = {
    opacity: isLoaded ? 1 : 0.01,
    transition: "opacity 240ms ease-out",
  };

  const showLoader = !resolvedSrc;

  const wrapperStyle: CSSProperties = {
    display: "grid",
    lineHeight: 0,
    ...style,
  };

  const gridCell: CSSProperties = {
    gridArea: "1 / 1",
  };

  useEffect(() => {
    // Don't retry if we've given up or we already have a resolved src
    if (giveUp || resolvedSrc) {
      return;
    }

    const timeout = setTimeout(() => {
      console.log("retry");
      globalDebugData.cachedImageLoadRetries++;
      setRetry((previous) => previous + 1);
    }, 5000);
    return () => clearTimeout(timeout);
  }, [giveUp, resolvedSrc, retry]);

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
