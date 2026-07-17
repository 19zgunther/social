import type { AnimationClip, Joint, JointId, Keyframe, Pose } from "./types";
import { clonePose, ensurePoseAngles, getRootJoint } from "./fk";

export type ValidateResult =
  | { ok: true; clip: AnimationClip }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasCycle(joints: Joint[]): boolean {
  const byId = new Map(joints.map((j) => [j.id, j]));
  for (const joint of joints) {
    const seen = new Set<JointId>();
    let current: Joint | undefined = joint;
    while (current) {
      if (seen.has(current.id)) {
        return true;
      }
      seen.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
  }
  return false;
}

function parsePose(raw: unknown, joints: Joint[], fallback: Pose): Pose | null {
  if (!isRecord(raw) || !isRecord(raw.root)) {
    return null;
  }
  const x = Number(raw.root.x);
  const y = Number(raw.root.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  const anglesRaw = isRecord(raw.angles) ? raw.angles : {};
  const angles: Record<JointId, number> = {};
  for (const joint of joints) {
    const v = anglesRaw[joint.id];
    angles[joint.id] = typeof v === "number" && Number.isFinite(v) ? v : (fallback.angles[joint.id] ?? 0);
  }
  return { root: { x, y }, angles };
}

export function validateClip(input: unknown): ValidateResult {
  if (!isRecord(input)) {
    return { ok: false, error: "Clip must be an object" };
  }
  if (input.version !== 1) {
    return { ok: false, error: "Unsupported clip version" };
  }
  if (!Array.isArray(input.joints) || input.joints.length === 0) {
    return { ok: false, error: "Clip needs at least one joint" };
  }

  const joints: Joint[] = [];
  const ids = new Set<JointId>();
  for (const raw of input.joints) {
    if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.name !== "string") {
      return { ok: false, error: "Invalid joint entry" };
    }
    if (ids.has(raw.id)) {
      return { ok: false, error: `Duplicate joint id: ${raw.id}` };
    }
    ids.add(raw.id);
    const parentId = raw.parentId === null || raw.parentId === undefined ? null : String(raw.parentId);
    const length = Number(raw.length ?? 0);
    if (!Number.isFinite(length) || length < 0) {
      return { ok: false, error: `Invalid length for joint ${raw.id}` };
    }
    joints.push({
      id: raw.id,
      name: raw.name,
      parentId,
      length: parentId === null ? 0 : length,
    });
  }

  const roots = joints.filter((j) => j.parentId === null);
  if (roots.length !== 1) {
    return { ok: false, error: "Clip must have exactly one root joint" };
  }
  for (const joint of joints) {
    if (joint.parentId !== null && !ids.has(joint.parentId)) {
      return { ok: false, error: `Missing parent for joint ${joint.id}` };
    }
  }
  if (hasCycle(joints)) {
    return { ok: false, error: "Joint tree has a cycle" };
  }

  const emptyFallback: Pose = { root: { x: 0, y: 0 }, angles: {} };
  const restPose =
    parsePose(input.restPose, joints, emptyFallback) ??
    ({
      root: { x: Number(isRecord(input.viewBox) ? 40 : 40), y: 40 },
      angles: Object.fromEntries(joints.map((j) => [j.id, 0])),
    } satisfies Pose);

  if (!Array.isArray(input.keyframes) || input.keyframes.length === 0) {
    return { ok: false, error: "Clip needs at least one keyframe" };
  }

  const keyframes: Keyframe[] = [];
  for (const raw of input.keyframes) {
    if (!isRecord(raw) || typeof raw.id !== "string") {
      return { ok: false, error: "Invalid keyframe" };
    }
    const t = Math.min(1, Math.max(0, Number(raw.t)));
    if (!Number.isFinite(t)) {
      return { ok: false, error: "Invalid keyframe t" };
    }
    const pose = parsePose(raw.pose, joints, restPose);
    if (!pose) {
      return { ok: false, error: `Invalid pose on keyframe ${raw.id}` };
    }
    keyframes.push({
      id: raw.id,
      t,
      pose: ensurePoseAngles(pose, joints, restPose),
    });
  }
  keyframes.sort((a, b) => a.t - b.t);

  const durationMs = Number(input.durationMs);
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return { ok: false, error: "Invalid durationMs" };
  }

  const viewBoxRaw = isRecord(input.viewBox) ? input.viewBox : {};
  const w = Number(viewBoxRaw.w ?? 80);
  const h = Number(viewBoxRaw.h ?? 100);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return { ok: false, error: "Invalid viewBox" };
  }

  const strokeWidth = Number(input.strokeWidth ?? 4);
  if (!Number.isFinite(strokeWidth) || strokeWidth <= 0) {
    return { ok: false, error: "Invalid strokeWidth" };
  }

  // Drop unused root reference check
  if (!getRootJoint(joints)) {
    return { ok: false, error: "Missing root" };
  }

  const clip: AnimationClip = {
    version: 1,
    durationMs,
    loop: Boolean(input.loop ?? true),
    viewBox: { w, h },
    strokeWidth,
    joints,
    restPose: ensurePoseAngles(restPose, joints, restPose),
    keyframes,
  };

  return { ok: true, clip };
}

export function cloneClip(clip: AnimationClip): AnimationClip {
  return {
    version: 1,
    durationMs: clip.durationMs,
    loop: clip.loop,
    viewBox: { ...clip.viewBox },
    strokeWidth: clip.strokeWidth,
    joints: clip.joints.map((j) => ({ ...j })),
    restPose: clonePose(clip.restPose),
    keyframes: clip.keyframes.map((kf) => ({
      id: kf.id,
      t: kf.t,
      pose: clonePose(kf.pose),
    })),
  };
}
