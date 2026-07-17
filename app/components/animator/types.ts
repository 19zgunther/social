export type JointId = string;

export type Joint = {
  id: JointId;
  name: string;
  parentId: JointId | null;
  length: number;
};

export type Vec2 = {
  x: number;
  y: number;
};

export type Pose = {
  root: Vec2;
  angles: Record<JointId, number>;
};

export type Keyframe = {
  id: string;
  t: number;
  pose: Pose;
};

export type AnimationClip = {
  version: 1;
  durationMs: number;
  loop: boolean;
  viewBox: { w: number; h: number };
  strokeWidth: number;
  joints: Joint[];
  restPose: Pose;
  keyframes: Keyframe[];
};

export type AnimationDocument = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  clip: AnimationClip;
};

export type AnimationSummary = {
  id: string;
  name: string;
  updatedAt: number;
  createdAt: number;
};

export type AnimatorMeta = {
  version: 1;
  openDocumentId: string | null;
  activeLoadingId: string | null;
};

export type WorldJoint = {
  id: JointId;
  parentId: JointId | null;
  x: number;
  y: number;
  angle: number;
};

export type EditorMode = "pose" | "rig";
