"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ImagePlus, LoaderCircle, RefreshCw, Square, Trash2, X } from "lucide-react";
import ImageViewerModal from "@/app/components/ImageViewerModal";
import CachedImage from "@/app/components/utils/CachedImage";
import { prepareImageForUpload } from "@/app/components/utils/client_file_storage_utils";
import { DONT_SWIPE_TABS_CLASSNAME } from "@/app/components/utils/useSwipeBack";
import { ApiError } from "@/app/types/interfaces";

export type FeedbackItem = {
  id: string;
  created_at: string;
  created_by: string;
  text: string;
  status: "resolved" | "unresolved";
  username: string;
  image_id: string | null;
  image_url: string | null;
  image_access_grant?: string | null;
};

type PendingComposeImage = {
  previewDataUrl: string;
  base64Data: string;
  mimeType: string;
};

const postWithAuth = async (path: string, body: unknown): Promise<Response> =>
  fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const readErrorMessage = async (response: Response): Promise<string> => {
  try {
    const body = (await response.json()) as ApiError;
    return body.error?.message ?? "Request failed.";
  } catch {
    return "Request failed.";
  }
};

const sortFeedbackItems = (rows: FeedbackItem[]): FeedbackItem[] =>
  [...rows].sort((a, b) => {
    const aResolved = a.status === "resolved";
    const bResolved = b.status === "resolved";
    if (aResolved !== bResolved) {
      return aResolved ? 1 : -1;
    }
    const aCreatedAtMs = Date.parse(a.created_at);
    const bCreatedAtMs = Date.parse(b.created_at);
    if (!Number.isNaN(aCreatedAtMs) && !Number.isNaN(bCreatedAtMs) && aCreatedAtMs !== bCreatedAtMs) {
      return bCreatedAtMs - aCreatedAtMs;
    }
    return b.id.localeCompare(a.id);
  });

export default function Feedback({
  currentUserId,
  isActive,
}: {
  currentUserId: string;
  isActive: boolean;
}) {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [draft, setDraft] = useState("");
  const [pendingImage, setPendingImage] = useState<PendingComposeImage | null>(null);
  const [isPickingImage, setIsPickingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [imageViewer, setImageViewer] = useState<{
    signedUrl: string | null;
    imageId: string | null;
    imageAccessGrant: string | null;
    imageStorageUserId: string;
    alt: string;
  } | null>(null);

  const load = useCallback(async (opts?: { refresh?: boolean }) => {
    const refresh = opts?.refresh ?? false;
    if (refresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setStatusMessage("");
    try {
      const response = await postWithAuth("/api/feedback-list", {});
      if (!response.ok) {
        setStatusMessage(await readErrorMessage(response));
        return;
      }
      const payload = (await response.json()) as { items?: FeedbackItem[] };
      setItems(sortFeedbackItems(payload.items ?? []));
    } catch (e) {
      setStatusMessage(e instanceof Error ? e.message : "Failed to load feedback.");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (isActive) {
      void load();
    }
  }, [isActive, load]);

  const canSubmit = Boolean(draft.trim() || pendingImage);

  const onPickImageClick = () => {
    fileInputRef.current?.click();
  };

  const onFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    setIsPickingImage(true);
    setStatusMessage("");
    try {
      const prepared = await prepareImageForUpload(file);
      setPendingImage({
        previewDataUrl: prepared.previewDataUrl,
        base64Data: prepared.base64Data,
        mimeType: prepared.mimeType,
      });
    } catch (e) {
      setStatusMessage(e instanceof Error ? e.message : "Could not use that image.");
    } finally {
      setIsPickingImage(false);
    }
  };

  const onSubmit = async () => {
    if (!canSubmit || isSubmitting) {
      return;
    }
    setIsSubmitting(true);
    setStatusMessage("");
    try {
      const response = await postWithAuth("/api/feedback-create", {
        text: draft.trim(),
        ...(pendingImage
          ? {
            image_base64_data: pendingImage.base64Data,
            image_mime_type: pendingImage.mimeType,
          }
          : {}),
      });
      if (!response.ok) {
        setStatusMessage(await readErrorMessage(response));
        return;
      }
      const payload = (await response.json()) as { item?: FeedbackItem };
      if (payload.item) {
        setItems((prev) => sortFeedbackItems([payload.item!, ...prev]));
      }
      setDraft("");
      setPendingImage(null);
    } catch (e) {
      setStatusMessage(e instanceof Error ? e.message : "Failed to submit.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleStatus = async (item: FeedbackItem) => {
    const next = item.status === "resolved" ? "unresolved" : "resolved";
    setPendingId(item.id);
    setStatusMessage("");
    try {
      const response = await postWithAuth("/api/feedback-status", {
        feedback_id: item.id,
        status: next,
      });
      if (!response.ok) {
        setStatusMessage(await readErrorMessage(response));
        return;
      }
      const payload = (await response.json()) as { item?: FeedbackItem };
      if (payload.item) {
        setItems((prev) => sortFeedbackItems(prev.map((r) => (r.id === item.id ? payload.item! : r))));
      }
    } catch (e) {
      setStatusMessage(e instanceof Error ? e.message : "Failed to update status.");
    } finally {
      setPendingId(null);
    }
  };

  const onDelete = async (item: FeedbackItem) => {
    if (item.created_by !== currentUserId) {
      return;
    }
    setPendingId(item.id);
    setStatusMessage("");
    try {
      const response = await postWithAuth("/api/feedback-delete", { feedback_id: item.id });
      if (!response.ok) {
        setStatusMessage(await readErrorMessage(response));
        return;
      }
      setItems((prev) => prev.filter((r) => r.id !== item.id));
    } catch (e) {
      setStatusMessage(e instanceof Error ? e.message : "Failed to delete.");
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-primary-background">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-accent-1 px-2 py-1.5">
        <h1 className="text-lg font-semibold text-foreground">Feedback</h1>
        <button
          type="button"
          onClick={() => void load({ refresh: true })}
          disabled={isRefreshing || isLoading}
          className="flex items-center gap-1.5 rounded-md border border-accent-1 px-1 py-0.5 text-sm text-accent-2 transition hover:border-accent-3 hover:text-accent-3 disabled:opacity-50"
          aria-label="Refresh feedback"
        >
          {isRefreshing ? (
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="h-4 w-4" aria-hidden />
          )}
          Refresh
        </button>
      </header>

      <div className="shrink-0 border-b border-accent-1 p-2">
        <label htmlFor="feedback-draft" className="sr-only">
          New bug report or message
        </label>
        <textarea
          id="feedback-draft"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Describe a bug, idea, or message for everyone…"
          rows={3}
          className="w-full resize-none rounded-md border border-accent-1 bg-secondary-background px-1.5 py-1 text-sm text-foreground placeholder:text-accent-2 focus:border-accent-3 focus:outline-none"
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => void onFileChange(e)}
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onPickImageClick}
            disabled={isPickingImage || isSubmitting}
            className="inline-flex items-center gap-1.5 rounded-md border border-accent-1 px-1 py-0.5 text-sm text-accent-2 transition hover:border-accent-3 hover:text-accent-3 disabled:opacity-50"
          >
            {isPickingImage ? (
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <ImagePlus className="h-4 w-4" aria-hidden />
            )}
            Add image
          </button>
          {pendingImage ? (
            <div className="relative inline-block">
              {/* eslint-disable-next-line @next/next/no-img-element -- local preview blob */}
              <img
                src={pendingImage.previewDataUrl}
                alt=""
                className="h-16 max-w-[8rem] rounded-md border border-accent-1 object-cover"
              />
              <button
                type="button"
                onClick={() => setPendingImage(null)}
                className="absolute -right-1 -top-1 rounded-full border border-accent-1 bg-secondary-background p-0 text-accent-2 shadow hover:text-foreground"
                aria-label="Remove image"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          ) : null}

          <div className="ml-auto flex justify-end">
            <button
              type="button"
              onClick={() => void onSubmit()}
              disabled={!canSubmit || isSubmitting}
              className="rounded-md bg-accent-3 px-2 py-1 text-sm font-medium text-primary-background transition hover:opacity-90 disabled:opacity-40"
            >
              {isSubmitting ? "Sending…" : "Submit"}
            </button>
          </div>
        </div>
      </div>

      {statusMessage ? (
        <p className="shrink-0 px-2 py-1 text-center text-sm text-red-400">{statusMessage}</p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
        {isLoading && !isRefreshing ? (
          <div className="flex justify-center py-6">
            <LoaderCircle className="h-8 w-8 animate-spin text-accent-2" aria-hidden />
          </div>
        ) : items.length === 0 ? (
          <p className="py-4 text-center text-sm text-accent-2">No feedback yet. Be the first to post.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {items.map((item) => {
              const isResolved = item.status === "resolved";
              const busy = pendingId === item.id;
              const canDelete = item.created_by === currentUserId;
              const hasImage = Boolean(
                item.image_id &&
                  (item.image_url || (item.image_access_grant && item.created_by)),
              );
              return (
                <li
                  key={item.id}
                  className="rounded-lg border border-accent-1 bg-secondary-background p-0.5"
                >
                  <div className="flex items-start gap-0">
                    <button
                      type="button"
                      onClick={() => void toggleStatus(item)}
                      disabled={busy}
                      title={isResolved ? "Mark unresolved" : "Mark resolved"}
                      className="shrink-0 rounded-md p-1 transition hover:bg-primary-background disabled:opacity-40"
                      aria-label={isResolved ? "Mark unresolved" : "Mark resolved"}
                    >
                      {busy ? (
                        <LoaderCircle className="h-5 w-5 animate-spin text-accent-2" aria-hidden />
                      ) : isResolved ? (
                        <Check className="h-5 w-5 text-green-500" aria-hidden strokeWidth={2.5} />
                      ) : (
                        <Square className="h-5 w-5 fill-orange-500/25 text-orange-500" aria-hidden strokeWidth={2} />
                      )}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-accent-2">
                        <span className="font-medium text-foreground">{item.username}</span>
                        <span aria-hidden>·</span>
                        <time dateTime={item.created_at}>
                          {new Date(item.created_at).toLocaleString()}
                        </time>
                      </div>
                      {item.text.trim() ? (
                        <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{item.text}</p>
                      ) : null}
                      {hasImage ? (
                        <button
                          type="button"
                          className={`mt-2 block max-w-full cursor-zoom-in rounded-md border-0 bg-transparent p-0 ${DONT_SWIPE_TABS_CLASSNAME}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setImageViewer({
                              signedUrl: item.image_url,
                              imageId: item.image_id,
                              imageAccessGrant: item.image_access_grant ?? null,
                              imageStorageUserId: item.created_by,
                              alt: "Feedback attachment",
                            });
                          }}
                        >
                          <CachedImage
                            signedUrl={item.image_url}
                            imageAccessGrant={item.image_access_grant ?? null}
                            imageStorageUserId={item.created_by}
                            imageId={item.image_id}
                            alt="Feedback attachment"
                            className="pointer-events-none max-h-32 max-w-full rounded-md border border-accent-1 object-contain"
                          />
                        </button>
                      ) : null}
                    </div>
                    {canDelete ? (
                      <button
                        type="button"
                        onClick={() => void onDelete(item)}
                        disabled={busy}
                        title="Delete"
                        className="shrink-0 rounded-md p-1 text-accent-2 transition hover:bg-primary-background hover:text-red-400 disabled:opacity-40"
                        aria-label="Delete feedback"
                      >
                        <Trash2 className="h-5 w-5" aria-hidden />
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <ImageViewerModal
        key={
          imageViewer
            ? `${imageViewer.imageId ?? ""}-${imageViewer.imageAccessGrant?.slice(0, 12) ?? imageViewer.signedUrl ?? ""}`
            : "feedback-image-viewer-closed"
        }
        open={imageViewer !== null}
        onClose={() => setImageViewer(null)}
        signedUrl={imageViewer?.signedUrl ?? null}
        imageId={imageViewer?.imageId ?? null}
        imageAccessGrant={imageViewer?.imageAccessGrant ?? null}
        imageStorageUserId={imageViewer?.imageStorageUserId ?? null}
        alt={imageViewer?.alt}
      />
    </div>
  );
}
