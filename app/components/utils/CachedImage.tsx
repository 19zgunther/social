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

const GIVE_UP_AFTER_RETRY = 5;

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
  const srcRef = useRef<string | null>(null);
  /** Fresh grant on each render; omit from load effect deps so rotating tokens don't re-run the pipeline. */
  const grantRef = useRef<string | null>(null);
  grantRef.current = imageAccessGrant ?? null;
  const threadIdRef = useRef<string | null>(null);
  threadIdRef.current = imageThreadId ?? null;

  const { className, style, ...restImgProps } = imgProps;

  const expectsRenderableImage = useMemo(
    () =>
      Boolean(
        imageId &&
          (signedUrl ||
            (imageAccessGrant && (imageStorageUserId || imageThreadId))),
      ),
    [imageId, signedUrl, imageAccessGrant, imageStorageUserId, imageThreadId],
  );

  useEffect(() => {
    srcRef.current = src;
  }, [src]);

  useEffect(() => {
    setRetry(0);
    setGiveUp(false);
  }, [imageId, signedUrl, imageAccessGrant, imageStorageUserId, imageThreadId]);

  useEffect(() => {
    let isCancelled = false;

    const load = async () => {
      if (imageId && srcRef.current) {
        const memoUrl = getImageUrlFromCache(imageId);
        if (memoUrl && memoUrl === srcRef.current) {
          return;
        }
      }

      const resolvedUrl = await imageCache(signedUrl ?? null, imageId, {
        grant: grantRef.current,
        storageUserId: imageStorageUserId,
        threadId: threadIdRef.current,
      });
      if (isCancelled) {
        console.log("load cancelled");
        globalDebugData.cachedImageLoadCancelleds++;
        return;
      }

      setSrc(resolvedUrl);
      if (!resolvedUrl && expectsRenderableImage && retry >= GIVE_UP_AFTER_RETRY) {
        setGiveUp(true);
      }
    };

    void load();

    return () => {
      isCancelled = true;
    };
  }, [imageId, signedUrl, imageStorageUserId, retry, expectsRenderableImage]);

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

  const showLoader =
    expectsRenderableImage
    && !giveUp
    && !(resolvedSrc && isLoaded);

  const wrapperStyle: CSSProperties = {
    display: "grid",
    lineHeight: 0,
    ...style,
  };

  const gridCell: CSSProperties = {
    gridArea: "1 / 1",
  };

  useEffect(() => {
    if (!expectsRenderableImage) {
      return;
    }
    if (giveUp) {
      return;
    }
    // Only retry the resolve pipeline when we still have no URL. Do not retry while <img> is decoding
    // (resolvedSrc set but onLoad not yet fired) — that was causing visible flashes back to the spinner.
    if (resolvedSrc) {
      return;
    }
    const timeout = setTimeout(() => {
      console.log("retry");
      globalDebugData.cachedImageLoadRetries++;
      setRetry((previous) => previous + 1);
    }, 5000);
    return () => clearTimeout(timeout);
  }, [expectsRenderableImage, giveUp, resolvedSrc, retry]);

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
