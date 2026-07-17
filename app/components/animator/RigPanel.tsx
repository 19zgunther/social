"use client";

import type { AnimationClip, Joint, JointId } from "./types";
import { collectSubtreeIds, getChildrenMap, getRootJoint } from "./fk";

type RigPanelProps = {
  clip: AnimationClip;
  selectedJointId: JointId | null;
  onSelectJoint: (id: JointId | null) => void;
  onRename: (id: JointId, name: string) => void;
  onLengthChange: (id: JointId, length: number) => void;
  onAddChild: (parentId: JointId) => void;
  onDeleteJoint: (id: JointId) => void;
};

function JointRow({
  joint,
  depth,
  selectedJointId,
  childrenMap,
  onSelectJoint,
}: {
  joint: Joint;
  depth: number;
  selectedJointId: JointId | null;
  childrenMap: Map<JointId | null, Joint[]>;
  onSelectJoint: (id: JointId | null) => void;
}) {
  const selected = joint.id === selectedJointId;
  const kids = childrenMap.get(joint.id) ?? [];

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          onSelectJoint(joint.id);
        }}
        className={`w-full text-left rounded px-2 py-1.5 text-xs ${
          selected ? "bg-blue-500/30 text-foreground" : "text-foreground hover:bg-accent-1/30"
        }`}
        style={{ paddingLeft: 8 + depth * 12 }}
      >
        {joint.name}
        <span className="text-accent-2 ml-1">({joint.id})</span>
      </button>
      {kids.map((child) => (
        <JointRow
          key={child.id}
          joint={child}
          depth={depth + 1}
          selectedJointId={selectedJointId}
          childrenMap={childrenMap}
          onSelectJoint={onSelectJoint}
        />
      ))}
    </div>
  );
}

export default function RigPanel({
  clip,
  selectedJointId,
  onSelectJoint,
  onRename,
  onLengthChange,
  onAddChild,
  onDeleteJoint,
}: RigPanelProps) {
  const childrenMap = getChildrenMap(clip.joints);
  const root = getRootJoint(clip.joints);
  const selected = clip.joints.find((j) => j.id === selectedJointId) ?? null;
  const canDelete =
    selected &&
    selected.parentId !== null &&
    collectSubtreeIds(clip.joints, selected.id).size >= 1;

  return (
    <aside className="flex w-56 shrink-0 flex-col border-l border-accent-1 bg-secondary-background">
      <div className="border-b border-accent-1 px-3 py-2 text-xs font-semibold text-foreground">
        Skeleton
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {root ? (
          <JointRow
            joint={root}
            depth={0}
            selectedJointId={selectedJointId}
            childrenMap={childrenMap}
            onSelectJoint={onSelectJoint}
          />
        ) : null}
      </div>

      {selected ? (
        <div className="border-t border-accent-1 space-y-2 p-3">
          <label className="block text-xs text-accent-2">
            Name
            <input
              value={selected.name}
              onChange={(event) => {
                onRename(selected.id, event.target.value);
              }}
              className="mt-1 w-full rounded border border-accent-1 bg-primary-background px-2 py-1 text-xs text-foreground"
            />
          </label>
          {selected.parentId !== null ? (
            <label className="block text-xs text-accent-2">
              Length
              <input
                type="number"
                min={1}
                step={0.5}
                value={selected.length}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (Number.isFinite(next) && next > 0) {
                    onLengthChange(selected.id, next);
                  }
                }}
                className="mt-1 w-full rounded border border-accent-1 bg-primary-background px-2 py-1 text-xs text-foreground"
              />
            </label>
          ) : null}
          <button
            type="button"
            onClick={() => {
              onAddChild(selected.id);
            }}
            className="w-full rounded border border-accent-1 px-2 py-1.5 text-xs text-foreground hover:bg-accent-1/30"
          >
            Add child joint
          </button>
          <button
            type="button"
            disabled={!canDelete}
            onClick={() => {
              if (selected.parentId === null) {
                return;
              }
              if (
                window.confirm(
                  `Delete “${selected.name}” and its children?`,
                )
              ) {
                onDeleteJoint(selected.id);
              }
            }}
            className="w-full rounded border border-red-600/50 px-2 py-1.5 text-xs text-red-400 hover:bg-red-600/10 disabled:opacity-40"
          >
            Delete joint
          </button>
        </div>
      ) : (
        <p className="border-t border-accent-1 p-3 text-xs text-accent-2">
          Select a joint to edit.
        </p>
      )}
    </aside>
  );
}
