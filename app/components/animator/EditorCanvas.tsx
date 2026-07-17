"use client";

import { useEffect, useRef } from "react";
import type { AnimationClip, EditorMode, JointId, Pose } from "./types";
import { computeWorldJoints, getJointMap, worldJointMap } from "./fk";
import StickFigureRenderer from "./StickFigureRenderer";

type EditorCanvasProps = {
  clip: AnimationClip;
  pose: Pose;
  mode: EditorMode;
  selectedJointId: JointId | null;
  color?: string;
  onSelectJoint: (id: JointId | null) => void;
  onPoseChange: (pose: Pose) => void;
  onRestLengthChange: (jointId: JointId, length: number, restAngle: number) => void;
};

function clientToSvg(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) {
    return { x: 0, y: 0 };
  }
  const local = pt.matrixTransform(ctm.inverse());
  return { x: local.x, y: local.y };
}

function normalizeAngle(radians: number): number {
  let a = radians;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export default function EditorCanvas({
  clip,
  pose,
  mode,
  selectedJointId,
  color = "#f3f6fc",
  onSelectJoint,
  onPoseChange,
  onRestLengthChange,
}: EditorCanvasProps) {
  const svgWrapRef = useRef<HTMLDivElement>(null);
  const poseRef = useRef(pose);
  const clipRef = useRef(clip);
  const modeRef = useRef(mode);
  poseRef.current = pose;
  clipRef.current = clip;
  modeRef.current = mode;

  const dragRef = useRef<{
    jointId: JointId;
    pointerId: number;
    parentX: number;
    parentY: number;
    parentAngle: number;
    boneLength: number;
  } | null>(null);

  const world = computeWorldJoints(clip, pose);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) {
        return;
      }
      const svg = svgWrapRef.current?.querySelector("svg");
      if (!svg) {
        return;
      }

      const { x, y } = clientToSvg(svg, event.clientX, event.clientY);
      const joint = getJointMap(clipRef.current.joints).get(drag.jointId);
      if (!joint) {
        return;
      }

      // Root: translate only — never rotates upstream of anything
      if (joint.parentId === null) {
        if (modeRef.current === "pose") {
          onPoseChange({
            ...poseRef.current,
            root: { x, y },
            angles: { ...poseRef.current.angles },
          });
        }
        return;
      }

      const dx = x - drag.parentX;
      const dy = y - drag.parentY;
      if (dx === 0 && dy === 0) {
        return;
      }

      const worldAngle = Math.atan2(dy, dx);
      const localAngle = normalizeAngle(worldAngle - drag.parentAngle);

      if (modeRef.current === "rig") {
        const length = Math.max(1, Math.hypot(dx, dy));
        onRestLengthChange(drag.jointId, length, localAngle);
        return;
      }

      // Pose: ONLY this joint's local angle. Parent stays fixed (frozen at drag
      // start). Children keep their local angles and swing with FK.
      // Bone length is unchanged — joint travels on a circle about the parent.
      onPoseChange({
        root: { ...poseRef.current.root },
        angles: {
          ...poseRef.current.angles,
          [drag.jointId]: localAngle,
        },
      });
    };

    const onPointerUp = (event: PointerEvent) => {
      if (dragRef.current?.pointerId === event.pointerId) {
        dragRef.current = null;
      }
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [onPoseChange, onRestLengthChange]);

  const onPointerDownJoint = (jointId: JointId, event: React.PointerEvent<SVGCircleElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onSelectJoint(jointId);

    const joints = clipRef.current.joints;
    const byJoint = getJointMap(joints);
    const byWorld = worldJointMap(computeWorldJoints(clipRef.current, poseRef.current));
    const joint = byJoint.get(jointId);
    if (!joint) {
      return;
    }

    if (joint.parentId === null) {
      dragRef.current = {
        jointId,
        pointerId: event.pointerId,
        parentX: 0,
        parentY: 0,
        parentAngle: 0,
        boneLength: 0,
      };
      return;
    }

    const parentWorld = byWorld.get(joint.parentId);
    if (!parentWorld) {
      return;
    }

    // Freeze parent world frame for the whole drag so upstream joints never move
    dragRef.current = {
      jointId,
      pointerId: event.pointerId,
      parentX: parentWorld.x,
      parentY: parentWorld.y,
      parentAngle: parentWorld.angle,
      boneLength: joint.length,
    };
  };

  return (
    <div
      ref={svgWrapRef}
      className="flex h-full min-h-0 flex-1 items-center justify-center bg-[#0a0b0e]"
      onClick={() => {
        if (!dragRef.current) {
          onSelectJoint(null);
        }
      }}
    >
      <StickFigureRenderer
        clip={clip}
        world={world}
        color={color}
        size={360}
        selectedJointId={selectedJointId}
        showHandles
        onPointerDownJoint={onPointerDownJoint}
      />
    </div>
  );
}
