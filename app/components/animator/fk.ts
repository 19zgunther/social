import type { AnimationClip, Joint, JointId, Pose, WorldJoint } from "./types";

export function getJointMap(joints: Joint[]): Map<JointId, Joint> {
  return new Map(joints.map((j) => [j.id, j]));
}

export function getChildrenMap(joints: Joint[]): Map<JointId | null, Joint[]> {
  const map = new Map<JointId | null, Joint[]>();
  for (const joint of joints) {
    const list = map.get(joint.parentId) ?? [];
    list.push(joint);
    map.set(joint.parentId, list);
  }
  return map;
}

export function getRootJoint(joints: Joint[]): Joint | null {
  return joints.find((j) => j.parentId === null) ?? null;
}

/**
 * Forward kinematics.
 * Root sits at pose.root. Each child is placed at parent + (length, parentWorldAngle + localAngle).
 * Root's initial parent direction is π/2 (down the screen).
 */
export function computeWorldJoints(clip: Pick<AnimationClip, "joints">, pose: Pose): WorldJoint[] {
  const children = getChildrenMap(clip.joints);
  const root = getRootJoint(clip.joints);
  if (!root) {
    return [];
  }

  const result: WorldJoint[] = [];

  const walk = (
    joint: Joint,
    parentX: number,
    parentY: number,
    parentDir: number,
  ) => {
    const localAngle = pose.angles[joint.id] ?? 0;
    const worldAngle = parentDir + localAngle;
    let x: number;
    let y: number;

    if (joint.parentId === null) {
      x = pose.root.x;
      y = pose.root.y;
    } else {
      x = parentX + Math.cos(worldAngle) * joint.length;
      y = parentY + Math.sin(worldAngle) * joint.length;
    }

    result.push({
      id: joint.id,
      parentId: joint.parentId,
      x,
      y,
      angle: worldAngle,
    });

    for (const child of children.get(joint.id) ?? []) {
      walk(child, x, y, worldAngle);
    }
  };

  walk(root, pose.root.x, pose.root.y, Math.PI / 2);
  return result;
}

export function clonePose(pose: Pose): Pose {
  return {
    root: { x: pose.root.x, y: pose.root.y },
    angles: { ...pose.angles },
  };
}

export function ensurePoseAngles(pose: Pose, joints: Joint[], fallback: Pose): Pose {
  const angles: Record<JointId, number> = { ...pose.angles };
  for (const joint of joints) {
    if (angles[joint.id] === undefined) {
      angles[joint.id] = fallback.angles[joint.id] ?? 0;
    }
  }
  return { root: { ...pose.root }, angles };
}

export function worldJointMap(world: WorldJoint[]): Map<JointId, WorldJoint> {
  return new Map(world.map((j) => [j.id, j]));
}

export function collectSubtreeIds(joints: Joint[], rootId: JointId): Set<JointId> {
  const children = getChildrenMap(joints);
  const ids = new Set<JointId>();
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    ids.add(id);
    for (const child of children.get(id) ?? []) {
      stack.push(child.id);
    }
  }
  return ids;
}
