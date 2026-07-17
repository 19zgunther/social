"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { DONT_SWIPE_TABS_CLASSNAME } from "@/app/components/utils/useSwipeBack";
import type {
  AnimationClip,
  AnimationDocument,
  AnimationSummary,
  EditorMode,
  JointId,
  Pose,
} from "./types";
import { clonePose, collectSubtreeIds, ensurePoseAngles } from "./fk";
import { samplePoseAt } from "./interpolate";
import { DEFAULT_CLIP } from "./defaultClip";
import {
  createAnimationDocument,
  deleteAnimation,
  ensureSeeded,
  getAnimation,
  getMeta,
  listAnimations,
  putAnimation,
  setMeta,
} from "./db";
import { setActiveLoadingAnimation } from "./storage";
import { cloneClip, validateClip } from "./validate";
import EditorCanvas from "./EditorCanvas";
import EditorTimeline from "./EditorTimeline";
import RigPanel from "./RigPanel";
import AnimationLibraryPanel from "./AnimationLibraryPanel";

type AnimationEditorModalProps = {
  open: boolean;
  onClose: () => void;
};

function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

const AUTOSAVE_MS = 500;

export default function AnimationEditorModal({ open, onClose }: AnimationEditorModalProps) {
  const [mounted, setMounted] = useState(false);
  const [ready, setReady] = useState(false);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [documentName, setDocumentName] = useState("Untitled");
  const [createdAt, setCreatedAt] = useState(Date.now());
  const [clip, setClip] = useState<AnimationClip>(() => cloneClip(DEFAULT_CLIP));
  const [library, setLibrary] = useState<AnimationSummary[]>([]);
  const [activeLoadingId, setActiveLoadingId] = useState<string | null>(null);
  const [mode, setMode] = useState<EditorMode>("pose");
  const [playheadT, setPlayheadT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selectedJointId, setSelectedJointId] = useState<JointId | null>(null);
  const [selectedKeyframeId, setSelectedKeyframeId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [keyframeClipboard, setKeyframeClipboard] = useState<Pose | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const playStartRef = useRef<{ wall: number; t0: number } | null>(null);
  const skipAutosaveRef = useRef(true);
  const autosaveTimerRef = useRef<number | null>(null);

  const playheadRef = useRef(playheadT);
  playheadRef.current = playheadT;
  const clipRef = useRef(clip);
  clipRef.current = clip;
  const docRef = useRef({ documentId, documentName, createdAt });
  docRef.current = { documentId, documentName, createdAt };

  useEffect(() => {
    setMounted(true);
  }, []);

  const refreshLibrary = useCallback(async () => {
    const [items, meta] = await Promise.all([listAnimations(), getMeta()]);
    setLibrary(items);
    setActiveLoadingId(meta.activeLoadingId);
  }, []);

  const applyDocument = useCallback((doc: AnimationDocument) => {
    skipAutosaveRef.current = true;
    setDocumentId(doc.id);
    setDocumentName(doc.name);
    setCreatedAt(doc.createdAt);
    setClip(cloneClip(doc.clip));
    setPlayheadT(0);
    setPlaying(false);
    setSelectedJointId(null);
    setSelectedKeyframeId(null);
    setSaveState("saved");
  }, []);

  const flushSave = useCallback(async () => {
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    const { documentId: id, documentName: name, createdAt: created } = docRef.current;
    if (!id) {
      return;
    }
    setSaveState("saving");
    const doc: AnimationDocument = {
      id,
      name,
      createdAt: created,
      updatedAt: Date.now(),
      clip: cloneClip(clipRef.current),
    };
    await putAnimation(doc);
    const meta = await getMeta();
    await setMeta({ ...meta, openDocumentId: id });
    setSaveState("saved");
    await refreshLibrary();
  }, [refreshLibrary]);

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    setReady(false);
    void (async () => {
      try {
        const doc = await ensureSeeded();
        if (cancelled) {
          return;
        }
        applyDocument(doc);
        await refreshLibrary();
        if (!cancelled) {
          setReady(true);
          setStatusMessage("");
        }
      } catch {
        if (!cancelled) {
          setStatusMessage("Failed to load animations.");
          setReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, applyDocument, refreshLibrary]);

  // Debounced auto-save
  useEffect(() => {
    if (!open || !ready || !documentId) {
      return;
    }
    if (skipAutosaveRef.current) {
      skipAutosaveRef.current = false;
      return;
    }
    setSaveState("saving");
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
    }
    autosaveTimerRef.current = window.setTimeout(() => {
      void flushSave();
    }, AUTOSAVE_MS);
    return () => {
      if (autosaveTimerRef.current !== null) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [open, ready, documentId, documentName, clip, flushSave]);

  useEffect(() => {
    if (!open || !playing) {
      playStartRef.current = null;
      return;
    }
    playStartRef.current = { wall: performance.now(), t0: playheadRef.current };
    let frame = 0;
    const tick = (now: number) => {
      const start = playStartRef.current;
      if (!start) {
        return;
      }
      const current = clipRef.current;
      const elapsed = now - start.wall;
      const duration = Math.max(current.durationMs, 1);
      let next = start.t0 + elapsed / duration;
      if (current.loop) {
        next = ((next % 1) + 1) % 1;
      } else if (next >= 1) {
        next = 1;
        setPlayheadT(1);
        setPlaying(false);
        return;
      }
      setPlayheadT(next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [open, playing]);

  const displayPose = useMemo(() => samplePoseAt(clip, playheadT), [clip, playheadT]);

  const writePoseToCurrentKeyframe = useCallback(
    (pose: Pose) => {
      setClip((prev) => {
        const near = [...prev.keyframes].find((kf) => Math.abs(kf.t - playheadT) < 0.008);
        const nextPose = ensurePoseAngles(pose, prev.joints, prev.restPose);
        if (near) {
          return {
            ...prev,
            keyframes: prev.keyframes.map((kf) =>
              kf.id === near.id ? { ...kf, pose: nextPose } : kf,
            ),
          };
        }
        const id = newId("kf");
        const keyframes = [
          ...prev.keyframes,
          { id, t: playheadT, pose: nextPose },
        ].sort((a, b) => a.t - b.t);
        setSelectedKeyframeId(id);
        return { ...prev, keyframes };
      });
    },
    [playheadT],
  );

  const openDocumentById = useCallback(
    async (id: string) => {
      await flushSave();
      const doc = await getAnimation(id);
      if (!doc) {
        setStatusMessage("Could not open animation.");
        return;
      }
      applyDocument(doc);
      const meta = await getMeta();
      await setMeta({ ...meta, openDocumentId: id });
      await refreshLibrary();
    },
    [flushSave, applyDocument, refreshLibrary],
  );

  const onNew = useCallback(async () => {
    await flushSave();
    const doc = createAnimationDocument("Untitled", DEFAULT_CLIP);
    await putAnimation(doc);
    const meta = await getMeta();
    await setMeta({ ...meta, openDocumentId: doc.id });
    applyDocument(doc);
    await refreshLibrary();
    setStatusMessage("Created new animation.");
  }, [flushSave, applyDocument, refreshLibrary]);

  const onDuplicate = useCallback(
    async (id: string) => {
      await flushSave();
      const source = await getAnimation(id);
      if (!source) {
        return;
      }
      const doc = createAnimationDocument(`${source.name} copy`, source.clip);
      await putAnimation(doc);
      const meta = await getMeta();
      await setMeta({ ...meta, openDocumentId: doc.id });
      applyDocument(doc);
      await refreshLibrary();
      setStatusMessage("Duplicated.");
    },
    [flushSave, applyDocument, refreshLibrary],
  );

  const onDelete = useCallback(
    async (id: string) => {
      await flushSave();
      const meta = await getMeta();
      await deleteAnimation(id);
      let nextMeta = { ...meta };
      if (meta.activeLoadingId === id) {
        nextMeta.activeLoadingId = null;
      }
      if (meta.openDocumentId === id || documentId === id) {
        const remaining = await listAnimations();
        if (remaining[0]) {
          nextMeta.openDocumentId = remaining[0].id;
          await setMeta(nextMeta);
          if (meta.activeLoadingId === id) {
            await setActiveLoadingAnimation(remaining[0].id);
            nextMeta = (await getMeta());
          }
          const doc = await getAnimation(remaining[0].id);
          if (doc) {
            applyDocument(doc);
          }
        } else {
          const doc = createAnimationDocument("Loading run", DEFAULT_CLIP);
          await putAnimation(doc);
          nextMeta = {
            version: 1,
            openDocumentId: doc.id,
            activeLoadingId: doc.id,
          };
          await setMeta(nextMeta);
          await setActiveLoadingAnimation(doc.id);
          applyDocument(doc);
        }
      } else {
        await setMeta(nextMeta);
        if (meta.activeLoadingId === id) {
          const remaining = await listAnimations();
          if (remaining[0]) {
            await setActiveLoadingAnimation(remaining[0].id);
          }
        }
      }
      await refreshLibrary();
      setStatusMessage("Deleted.");
    },
    [flushSave, documentId, applyDocument, refreshLibrary],
  );

  const onRename = useCallback(
    async (id: string, name: string) => {
      if (id === documentId) {
        setDocumentName(name);
        return;
      }
      const doc = await getAnimation(id);
      if (!doc) {
        return;
      }
      await putAnimation({ ...doc, name });
      await refreshLibrary();
    },
    [documentId, refreshLibrary],
  );

  const onUseForLoading = useCallback(
    async (id: string) => {
      await flushSave();
      await setActiveLoadingAnimation(id);
      await refreshLibrary();
      setStatusMessage("Set as loading animation.");
    },
    [flushSave, refreshLibrary],
  );

  const handleClose = useCallback(() => {
    void (async () => {
      await flushSave();
      onClose();
    })();
  }, [flushSave, onClose]);

  const copyKeyframe = useCallback(() => {
    const selected = selectedKeyframeId
      ? clip.keyframes.find((kf) => kf.id === selectedKeyframeId)
      : null;
    const pose = selected
      ? clonePose(selected.pose)
      : clonePose(samplePoseAt(clip, playheadT));
    setKeyframeClipboard(pose);
    setStatusMessage(selected ? "Keyframe copied." : "Pose at playhead copied.");
  }, [selectedKeyframeId, clip, playheadT]);

  const pasteKeyframe = useCallback(() => {
    if (!keyframeClipboard) {
      return;
    }
    const pose = ensurePoseAngles(
      clonePose(keyframeClipboard),
      clip.joints,
      clip.restPose,
    );
    const near = clip.keyframes.find((kf) => Math.abs(kf.t - playheadT) < 0.008);
    if (near) {
      setClip((prev) => ({
        ...prev,
        keyframes: prev.keyframes.map((kf) =>
          kf.id === near.id ? { ...kf, pose } : kf,
        ),
      }));
      setSelectedKeyframeId(near.id);
      setStatusMessage("Pasted onto keyframe at playhead.");
      return;
    }
    const id = newId("kf");
    setClip((prev) => ({
      ...prev,
      keyframes: [...prev.keyframes, { id, t: playheadT, pose }].sort(
        (a, b) => a.t - b.t,
      ),
    }));
    setSelectedKeyframeId(id);
    setStatusMessage("Keyframe pasted at playhead.");
  }, [keyframeClipboard, clip.joints, clip.restPose, clip.keyframes, playheadT]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!open) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        setPlaying((p) => !p);
      }
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === "c") {
        event.preventDefault();
        copyKeyframe();
        return;
      }
      if (mod && event.key.toLowerCase() === "v") {
        event.preventDefault();
        pasteKeyframe();
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        if (selectedKeyframeId && clip.keyframes.length > 1) {
          event.preventDefault();
          setClip((prev) => ({
            ...prev,
            keyframes: prev.keyframes.filter((kf) => kf.id !== selectedKeyframeId),
          }));
          setSelectedKeyframeId(null);
        }
      }
    },
    [open, selectedKeyframeId, clip.keyframes.length, copyKeyframe, pasteKeyframe],
  );

  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onKeyDown]);

  if (!mounted || !open) {
    return null;
  }

  return createPortal(
    <div
      className={`${DONT_SWIPE_TABS_CLASSNAME} fixed inset-0 z-[2200] flex flex-col bg-primary-background text-foreground`}
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-accent-1 px-3 py-2">
        <h2 className="text-sm font-semibold mr-1">Animation Editor</h2>
        <input
          value={documentName}
          onChange={(event) => {
            setDocumentName(event.target.value);
          }}
          className="min-w-[8rem] max-w-[12rem] rounded border border-accent-1 bg-secondary-background px-2 py-1 text-xs text-foreground"
          aria-label="Animation name"
        />
        <span className="text-[10px] text-accent-2 tabular-nums">
          {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : ""}
        </span>

        <div className="flex rounded border border-accent-1 overflow-hidden text-xs">
          <button
            type="button"
            onClick={() => {
              setMode("pose");
            }}
            className={`px-3 py-1.5 ${mode === "pose" ? "bg-accent-1 text-foreground" : "text-accent-2"}`}
          >
            Pose
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("rig");
            }}
            className={`px-3 py-1.5 ${mode === "rig" ? "bg-accent-1 text-foreground" : "text-accent-2"}`}
          >
            Rig
          </button>
        </div>

        <button
          type="button"
          onClick={() => {
            setClip(cloneClip(DEFAULT_CLIP));
            setPlayheadT(0);
            setSelectedKeyframeId(null);
            setStatusMessage("Reset clip to bundled default.");
          }}
          className="rounded border border-accent-1 px-3 py-1.5 text-xs hover:bg-accent-1/30"
        >
          Reset clip
        </button>
        <button
          type="button"
          onClick={() => {
            const text = JSON.stringify(clip, null, 2);
            void navigator.clipboard.writeText(text).then(() => {
              setStatusMessage("JSON copied to clipboard.");
            });
            const blob = new Blob([text], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${documentName.replace(/\s+/g, "-").toLowerCase() || "animation"}.json`;
            a.click();
            URL.revokeObjectURL(url);
          }}
          className="rounded border border-accent-1 px-3 py-1.5 text-xs hover:bg-accent-1/30"
        >
          Export JSON
        </button>
        <button
          type="button"
          onClick={() => {
            fileInputRef.current?.click();
          }}
          className="rounded border border-accent-1 px-3 py-1.5 text-xs hover:bg-accent-1/30"
        >
          Import JSON
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) {
              return;
            }
            void file.text().then((text) => {
              try {
                const result = validateClip(JSON.parse(text) as unknown);
                if (!result.ok) {
                  setStatusMessage(result.error);
                  return;
                }
                setClip(cloneClip(result.clip));
                setPlayheadT(0);
                setSelectedKeyframeId(null);
                setStatusMessage("Imported into current animation.");
              } catch {
                setStatusMessage("Could not parse JSON.");
              }
            });
          }}
        />

        {documentId && documentId !== activeLoadingId ? (
          <button
            type="button"
            onClick={() => {
              void onUseForLoading(documentId);
            }}
            className="rounded border border-blue-400/50 px-3 py-1.5 text-xs text-blue-300 hover:bg-blue-500/20"
          >
            Use for loading
          </button>
        ) : documentId === activeLoadingId ? (
          <span className="text-[10px] text-blue-300">Active loading</span>
        ) : null}

        {statusMessage ? (
          <span className="text-xs text-accent-2">{statusMessage}</span>
        ) : null}

        <button
          type="button"
          onClick={handleClose}
          className="ml-auto rounded p-1.5 hover:bg-accent-1/30"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>
      </header>

      {!ready ? (
        <div className="flex flex-1 items-center justify-center text-sm text-accent-2">
          Loading library…
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <AnimationLibraryPanel
            items={library}
            openDocumentId={documentId}
            activeLoadingId={activeLoadingId}
            onOpen={(id) => {
              void openDocumentById(id);
            }}
            onNew={() => {
              void onNew();
            }}
            onRename={(id, name) => {
              void onRename(id, name);
            }}
            onDuplicate={(id) => {
              void onDuplicate(id);
            }}
            onDelete={(id) => {
              void onDelete(id);
            }}
            onUseForLoading={(id) => {
              void onUseForLoading(id);
            }}
          />

          <div className="flex min-w-0 flex-1 flex-col">
            <EditorCanvas
              clip={clip}
              pose={displayPose}
              mode={mode}
              selectedJointId={selectedJointId}
              onSelectJoint={setSelectedJointId}
              onPoseChange={(pose) => {
                setPlaying(false);
                writePoseToCurrentKeyframe(pose);
              }}
              onRestLengthChange={(jointId, length, restAngle) => {
                setClip((prev) => ({
                  ...prev,
                  joints: prev.joints.map((j) =>
                    j.id === jointId ? { ...j, length } : j,
                  ),
                  restPose: {
                    ...prev.restPose,
                    angles: {
                      ...prev.restPose.angles,
                      [jointId]: restAngle,
                    },
                  },
                  keyframes: prev.keyframes.map((kf) => ({
                    ...kf,
                    pose: {
                      ...kf.pose,
                      angles: {
                        ...kf.pose.angles,
                        [jointId]: restAngle,
                      },
                    },
                  })),
                }));
              }}
            />
            <EditorTimeline
              durationMs={clip.durationMs}
              playheadT={playheadT}
              playing={playing}
              loop={clip.loop}
              keyframes={clip.keyframes}
              selectedKeyframeId={selectedKeyframeId}
              canPaste={keyframeClipboard !== null}
              onPlayheadChange={(t) => {
                setPlaying(false);
                setPlayheadT(t);
                const near = clip.keyframes.find((kf) => Math.abs(kf.t - t) < 0.008);
                setSelectedKeyframeId(near?.id ?? null);
              }}
              onTogglePlay={() => {
                setPlaying((p) => !p);
              }}
              onToggleLoop={() => {
                setClip((prev) => ({ ...prev, loop: !prev.loop }));
              }}
              onSelectKeyframe={(id) => {
                setSelectedKeyframeId(id);
                const kf = clip.keyframes.find((k) => k.id === id);
                if (kf) {
                  setPlaying(false);
                  setPlayheadT(kf.t);
                }
              }}
              onAddKeyframe={() => {
                const pose = clonePose(samplePoseAt(clip, playheadT));
                const id = newId("kf");
                setClip((prev) => ({
                  ...prev,
                  keyframes: [...prev.keyframes, { id, t: playheadT, pose }].sort(
                    (a, b) => a.t - b.t,
                  ),
                }));
                setSelectedKeyframeId(id);
              }}
              onCopyKeyframe={copyKeyframe}
              onPasteKeyframe={pasteKeyframe}
              onDeleteKeyframe={() => {
                if (!selectedKeyframeId || clip.keyframes.length <= 1) {
                  return;
                }
                setClip((prev) => ({
                  ...prev,
                  keyframes: prev.keyframes.filter((kf) => kf.id !== selectedKeyframeId),
                }));
                setSelectedKeyframeId(null);
              }}
              onDurationChange={(ms) => {
                setClip((prev) => ({ ...prev, durationMs: ms }));
              }}
              onKeyframeTimeChange={(id, t) => {
                setClip((prev) => ({
                  ...prev,
                  keyframes: prev.keyframes
                    .map((kf) => (kf.id === id ? { ...kf, t } : kf))
                    .sort((a, b) => a.t - b.t),
                }));
                setPlayheadT(t);
              }}
            />
          </div>

          <RigPanel
            clip={clip}
            selectedJointId={selectedJointId}
            onSelectJoint={setSelectedJointId}
            onRename={(id, name) => {
              setClip((prev) => ({
                ...prev,
                joints: prev.joints.map((j) => (j.id === id ? { ...j, name } : j)),
              }));
            }}
            onLengthChange={(id, length) => {
              setClip((prev) => ({
                ...prev,
                joints: prev.joints.map((j) => (j.id === id ? { ...j, length } : j)),
              }));
            }}
            onAddChild={(parentId) => {
              const id = newId("joint");
              setClip((prev) => {
                const angles = { ...prev.restPose.angles, [id]: 0 };
                return {
                  ...prev,
                  joints: [
                    ...prev.joints,
                    { id, name: "New joint", parentId, length: 12 },
                  ],
                  restPose: { ...prev.restPose, angles },
                  keyframes: prev.keyframes.map((kf) => ({
                    ...kf,
                    pose: {
                      ...kf.pose,
                      angles: { ...kf.pose.angles, [id]: 0 },
                    },
                  })),
                };
              });
              setSelectedJointId(id);
              setMode("rig");
            }}
            onDeleteJoint={(id) => {
              setClip((prev) => {
                const remove = collectSubtreeIds(prev.joints, id);
                if (remove.has(prev.joints.find((j) => j.parentId === null)?.id ?? "")) {
                  return prev;
                }
                const strip = (pose: Pose): Pose => {
                  const angles = { ...pose.angles };
                  for (const rid of remove) {
                    delete angles[rid];
                  }
                  return { root: { ...pose.root }, angles };
                };
                return {
                  ...prev,
                  joints: prev.joints.filter((j) => !remove.has(j.id)),
                  restPose: strip(prev.restPose),
                  keyframes: prev.keyframes.map((kf) => ({
                    ...kf,
                    pose: strip(kf.pose),
                  })),
                };
              });
              setSelectedJointId(null);
            }}
          />
        </div>
      )}
    </div>,
    document.body,
  );
}
