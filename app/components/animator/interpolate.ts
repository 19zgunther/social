import type { AnimationClip, JointId, Pose } from "./types";
import { clonePose, ensurePoseAngles } from "./fk";

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Shortest-path angle interpolation (radians). */
export function lerpAngle(a: number, b: number, t: number): number {
  let delta = b - a;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return a + delta * t;
}

export function lerpPose(a: Pose, b: Pose, t: number, jointIds: JointId[]): Pose {
  const angles: Record<JointId, number> = {};
  for (const id of jointIds) {
    angles[id] = lerpAngle(a.angles[id] ?? 0, b.angles[id] ?? 0, t);
  }
  return {
    root: {
      x: lerp(a.root.x, b.root.x, t),
      y: lerp(a.root.y, b.root.y, t),
    },
    angles,
  };
}

export function samplePoseAt(clip: AnimationClip, tNorm: number): Pose {
  const t = ((tNorm % 1) + 1) % 1;
  const jointIds = clip.joints.map((j) => j.id);
  const frames = [...clip.keyframes].sort((a, b) => a.t - b.t);

  if (frames.length === 0) {
    return clonePose(clip.restPose);
  }

  if (frames.length === 1) {
    return ensurePoseAngles(clonePose(frames[0]!.pose), clip.joints, clip.restPose);
  }

  const first = frames[0]!;
  const last = frames[frames.length - 1]!;

  // Find segment [a, b] containing t (with optional loop wrap last→first)
  let a = last;
  let b = first;
  let localT = 0;

  if (t <= first.t && clip.loop) {
    const span = 1 - last.t + first.t;
    localT = span <= 0 ? 0 : (t + 1 - last.t) / span;
    a = last;
    b = first;
  } else if (t <= first.t) {
    return ensurePoseAngles(clonePose(first.pose), clip.joints, clip.restPose);
  } else if (t >= last.t && clip.loop) {
    const span = 1 - last.t + first.t;
    localT = span <= 0 ? 0 : (t - last.t) / span;
    a = last;
    b = first;
  } else if (t >= last.t) {
    return ensurePoseAngles(clonePose(last.pose), clip.joints, clip.restPose);
  } else {
    for (let i = 0; i < frames.length - 1; i += 1) {
      const left = frames[i]!;
      const right = frames[i + 1]!;
      if (t >= left.t && t <= right.t) {
        a = left;
        b = right;
        const span = right.t - left.t;
        localT = span <= 0 ? 0 : (t - left.t) / span;
        break;
      }
    }
  }

  const poseA = ensurePoseAngles(a.pose, clip.joints, clip.restPose);
  const poseB = ensurePoseAngles(b.pose, clip.joints, clip.restPose);
  return lerpPose(poseA, poseB, localT, jointIds);
}
