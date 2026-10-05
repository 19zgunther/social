"use client";

import { useEffect, useState } from "react";

const LOADER_WIDTH = 90;
const LOADER_HEIGHT = 24;
const EXPAND_MS = 700;
const COLLAPSE_MS = 1000;

type LoaderProps = {
  className?: string;
  /** Visual scale relative to the default 90×24 size. */
  scale?: number;
  /** When false, collapses over 1s then unmounts. Defaults to true. */
  show?: boolean;
  /**
   * Animate height from 0 on show and back to 0 on hide.
   * Set false when a parent already animates the loading container.
   */
  animateHeight?: boolean;
};

export default function Loader({
  className,
  scale = 1,
  show = true,
  animateHeight = true,
}: LoaderProps) {
  const [rendered, setRendered] = useState(show);
  const [expanded, setExpanded] = useState(!animateHeight && show);

  useEffect(() => {
    if (!animateHeight) {
      setRendered(show);
      setExpanded(show);
      return;
    }

    if (show) {
      setRendered(true);
      const frameId = requestAnimationFrame(() => {
        setExpanded(true);
      });
      return () => cancelAnimationFrame(frameId);
    }

    setExpanded(false);
    const timeoutId = window.setTimeout(() => {
      setRendered(false);
    }, COLLAPSE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [animateHeight, show]);

  if (!rendered) {
    return null;
  }

  const width = LOADER_WIDTH * scale;
  const height = LOADER_HEIGHT * scale;

  return (
    <div
      className={className}
      style={{
        width,
        height: !animateHeight || expanded ? height : 0,
        overflow: "hidden",
        transition: animateHeight
          ? `height ${expanded ? EXPAND_MS : COLLAPSE_MS}ms ease`
          : undefined,
      }}
    >
      <div
        className="loader"
        style={
          scale === 1
            ? undefined
            : {
                transform: `scale(${scale})`,
                transformOrigin: "top left",
              }
        }
      />
    </div>
  );
}
