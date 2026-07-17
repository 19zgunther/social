"use client";

import type { AnimationClip, JointId, WorldJoint } from "./types";
import { worldJointMap } from "./fk";

type StickFigureRendererProps = {
  clip: Pick<AnimationClip, "joints" | "viewBox" | "strokeWidth">;
  world: WorldJoint[];
  color: string;
  size?: number;
  className?: string;
  selectedJointId?: JointId | null;
  showHandles?: boolean;
  onPointerDownJoint?: (jointId: JointId, event: React.PointerEvent<SVGCircleElement>) => void;
};

export default function StickFigureRenderer({
  clip,
  world,
  color,
  size,
  className,
  selectedJointId = null,
  showHandles = false,
  onPointerDownJoint,
}: StickFigureRendererProps) {
  const byId = worldJointMap(world);
  const sw = clip.strokeWidth;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${clip.viewBox.w} ${clip.viewBox.h}`}
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ display: "block", overflow: "visible", touchAction: "none" }}
    >
      {clip.joints.map((joint) => {
        if (!joint.parentId) {
          return null;
        }
        const child = byId.get(joint.id);
        const parent = byId.get(joint.parentId);
        if (!child || !parent) {
          return null;
        }
        const isHead = joint.id === "head" || joint.name.toLowerCase() === "head";
        if (isHead) {
          const r = Math.max(joint.length * 0.45, sw * 1.2);
          return (
            <g key={`bone-${joint.id}`}>
              <line
                x1={parent.x}
                y1={parent.y}
                x2={child.x}
                y2={child.y}
                stroke={color}
                strokeWidth={sw * 0.7}
                strokeLinecap="round"
              />
              <circle cx={child.x} cy={child.y} r={r} fill={color} />
            </g>
          );
        }
        return (
          <line
            key={`bone-${joint.id}`}
            x1={parent.x}
            y1={parent.y}
            x2={child.x}
            y2={child.y}
            stroke={color}
            strokeWidth={sw}
            strokeLinecap="round"
          />
        );
      })}

      {showHandles
        ? world.map((joint) => {
            const selected = joint.id === selectedJointId;
            return (
              <circle
                key={`handle-${joint.id}`}
                cx={joint.x}
                cy={joint.y}
                r={selected ? 5 : 3.5}
                fill={selected ? "#60a5fa" : color}
                stroke={selected ? "#93c5fd" : "transparent"}
                strokeWidth={1.5}
                style={{ cursor: "grab" }}
                onPointerDown={(event) => {
                  onPointerDownJoint?.(joint.id, event);
                }}
              />
            );
          })
        : null}
    </svg>
  );
}
