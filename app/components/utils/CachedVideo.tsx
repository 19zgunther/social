"use client";

import { VideoHTMLAttributes, useEffect, useRef, useState } from "react";
import { getImageUrlFromCache, imageCache } from "@/app/lib/imageCache";

type CachedVideoProps = Omit<VideoHTMLAttributes<HTMLVideoElement>, "src" | "poster"> & {
  mediaId: string | null;
  mediaAccessGrant?: string | null;
  mediaStorageUserId?: string | null;
  posterId?: string | null;
  posterAccessGrant?: string | null;
  isActive?: boolean;
};

export default function CachedVideo({
  mediaId,
  mediaAccessGrant = null,
  mediaStorageUserId = null,
  posterId = null,
  posterAccessGrant = null,
  isActive = false,
  className,
  ...videoProps
}: CachedVideoProps) {
  const [src, setSrc] = useState<string | null>(() =>
    mediaId ? (getImageUrlFromCache(mediaId) ?? null) : null,
  );
  const [poster, setPoster] = useState<string | null>(() =>
    posterId ? (getImageUrlFromCache(posterId) ?? null) : null,
  );
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const resolve = async (
      id: string | null,
      grant: string | null,
      setUrl: (url: string | null) => void,
    ) => {
      if (!id) {
        setUrl(null);
        return;
      }
      const memo = getImageUrlFromCache(id);
      if (memo) {
        setUrl(memo);
        return;
      }
      const url = await imageCache({
        signedUrl: null,
        imageId: id,
        grant,
        storageUserId: mediaStorageUserId,
      });
      if (!cancelled) {
        setUrl(url);
      }
    };

    void resolve(mediaId, mediaAccessGrant, setSrc);
    void resolve(posterId, posterAccessGrant, setPoster);
    return () => {
      cancelled = true;
    };
  }, [mediaId, mediaAccessGrant, mediaStorageUserId, posterId, posterAccessGrant]);

  useEffect(() => {
    if (!isActive) {
      videoRef.current?.pause();
    }
  }, [isActive]);

  return (
    <video
      {...videoProps}
      ref={videoRef}
      src={src ?? undefined}
      poster={poster ?? undefined}
      className={className}
      playsInline
      preload="metadata"
      controls={isActive}
    />
  );
}
