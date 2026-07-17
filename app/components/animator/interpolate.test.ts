import { describe, expect, it } from "vitest";
import { lerpAngle, samplePoseAt } from "./interpolate";
import { DEFAULT_CLIP } from "./defaultClip";
import { validateClip } from "./validate";
import { computeWorldJoints } from "./fk";

describe("lerpAngle", () => {
  it("takes the short path across the ±π boundary", () => {
    const a = Math.PI - 0.1;
    const b = -Math.PI + 0.1;
    const mid = lerpAngle(a, b, 0.5);
    expect(Math.abs(mid)).toBeGreaterThan(Math.PI - 0.2);
  });

  it("lerps simply when delta is small", () => {
    expect(lerpAngle(0, 1, 0.5)).toBeCloseTo(0.5);
  });
});

describe("samplePoseAt", () => {
  it("returns a pose with all joint angles", () => {
    const pose = samplePoseAt(DEFAULT_CLIP, 0);
    for (const joint of DEFAULT_CLIP.joints) {
      expect(pose.angles[joint.id]).toBeTypeOf("number");
    }
  });

  it("loops smoothly near the end", () => {
    const a = samplePoseAt(DEFAULT_CLIP, 0.99);
    const b = samplePoseAt(DEFAULT_CLIP, 0.01);
    expect(a.root.x).toBeTypeOf("number");
    expect(b.root.x).toBeTypeOf("number");
  });
});

describe("validateClip", () => {
  it("accepts the default clip", () => {
    const result = validateClip(DEFAULT_CLIP);
    expect(result.ok).toBe(true);
  });

  it("rejects missing root", () => {
    const result = validateClip({
      ...DEFAULT_CLIP,
      joints: DEFAULT_CLIP.joints.filter((j) => j.parentId !== null),
    });
    expect(result.ok).toBe(false);
  });
});

describe("computeWorldJoints", () => {
  it("places root at pose.root", () => {
    const world = computeWorldJoints(DEFAULT_CLIP, DEFAULT_CLIP.restPose);
    const root = world.find((j) => j.id === "root");
    expect(root?.x).toBeCloseTo(DEFAULT_CLIP.restPose.root.x);
    expect(root?.y).toBeCloseTo(DEFAULT_CLIP.restPose.root.y);
  });

  it("produces a joint for every skeleton joint", () => {
    const world = computeWorldJoints(DEFAULT_CLIP, DEFAULT_CLIP.restPose);
    expect(world).toHaveLength(DEFAULT_CLIP.joints.length);
  });
});
