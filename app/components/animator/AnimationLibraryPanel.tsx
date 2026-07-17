"use client";

import type { AnimationSummary } from "./types";

function formatUpdatedAt(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) {
    return "just now";
  }
  if (diff < 3_600_000) {
    return `${Math.floor(diff / 60_000)}m ago`;
  }
  if (diff < 86_400_000) {
    return `${Math.floor(diff / 3_600_000)}h ago`;
  }
  return new Date(ms).toLocaleDateString();
}

type AnimationLibraryPanelProps = {
  items: AnimationSummary[];
  openDocumentId: string | null;
  activeLoadingId: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onUseForLoading: (id: string) => void;
};

export default function AnimationLibraryPanel({
  items,
  openDocumentId,
  activeLoadingId,
  onOpen,
  onNew,
  onRename,
  onDuplicate,
  onDelete,
  onUseForLoading,
}: AnimationLibraryPanelProps) {
  return (
    <aside className="flex w-52 shrink-0 flex-col border-r border-accent-1 bg-secondary-background">
      <div className="flex items-center justify-between border-b border-accent-1 px-3 py-2">
        <span className="text-xs font-semibold text-foreground">Library</span>
        <button
          type="button"
          onClick={onNew}
          className="rounded border border-accent-1 px-2 py-0.5 text-xs text-foreground hover:bg-accent-1/30"
        >
          New
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <p className="p-3 text-xs text-accent-2">No animations yet.</p>
        ) : (
          items.map((item) => {
            const isOpen = item.id === openDocumentId;
            const isActive = item.id === activeLoadingId;
            return (
              <div
                key={item.id}
                className={`border-b border-accent-1/50 px-2 py-2 ${
                  isOpen ? "bg-blue-500/20" : "hover:bg-accent-1/20"
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    onOpen(item.id);
                  }}
                  className="w-full text-left"
                >
                  <p className="truncate text-xs font-medium text-foreground">{item.name}</p>
                  <p className="text-[10px] text-accent-2">
                    {formatUpdatedAt(item.updatedAt)}
                    {isActive ? " · loading" : ""}
                  </p>
                </button>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  <button
                    type="button"
                    title="Rename"
                    onClick={() => {
                      const next = window.prompt("Rename animation", item.name);
                      if (next && next.trim()) {
                        onRename(item.id, next.trim());
                      }
                    }}
                    className="rounded border border-accent-1 px-1.5 py-0.5 text-[10px] text-accent-2 hover:text-foreground"
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onDuplicate(item.id);
                    }}
                    className="rounded border border-accent-1 px-1.5 py-0.5 text-[10px] text-accent-2 hover:text-foreground"
                  >
                    Dup
                  </button>
                  <button
                    type="button"
                    disabled={isActive}
                    onClick={() => {
                      onUseForLoading(item.id);
                    }}
                    className="rounded border border-accent-1 px-1.5 py-0.5 text-[10px] text-accent-2 hover:text-foreground disabled:opacity-40"
                  >
                    {isActive ? "Active" : "Use loading"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`Delete “${item.name}”?`)) {
                        onDelete(item.id);
                      }
                    }}
                    className="rounded border border-red-600/40 px-1.5 py-0.5 text-[10px] text-red-400"
                  >
                    Del
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
