"use client";

import { useEffect, useMemo, useState } from "react";

const PROMPT_INTERVAL_MS = 2000;
const PROMPT_SLIDE_MS = 450;
const PROMPT_LINE_EM = 1.35;

export type CollagePromptButtonProps = {
  onClick: () => void;
  ariaLabel: string;
  imageSrcs: string[];
  promptPrefix: string;
  prompts: string[];
};

export default function CollagePromptButton({
  onClick,
  ariaLabel,
  imageSrcs,
  promptPrefix,
  prompts,
}: CollagePromptButtonProps) {
  const [promptIndex, setPromptIndex] = useState(0);
  const [promptAnimate, setPromptAnimate] = useState(true);

  const promptSlides = useMemo(
    () => (prompts.length > 0 ? [...prompts, prompts[0]] : []),
    [prompts],
  );
  const promptSizer = useMemo(
    () => [...prompts].sort((a, b) => a.length - b.length)[0] ?? "",
    [prompts],
  );

  useEffect(() => {
    if (prompts.length === 0) {
      return;
    }
    const intervalId = window.setInterval(() => {
      setPromptIndex((previous) => previous + 1);
    }, PROMPT_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [prompts.length]);

  useEffect(() => {
    if (promptIndex < prompts.length) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setPromptAnimate(false);
      setPromptIndex(0);
    }, PROMPT_SLIDE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [promptIndex, prompts.length]);

  useEffect(() => {
    if (promptAnimate || promptIndex !== 0) {
      return;
    }
    const frameId = window.requestAnimationFrame(() => {
      setPromptAnimate(true);
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [promptAnimate, promptIndex]);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="create-post-rgb-border relative flex min-h-[40vw] w-full overflow-hidden rounded-2xl font-semibold shadow-sm"
    >
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 flex h-[170%] w-[190%] -translate-x-1/2 -translate-y-1/2 skew-x-[-28deg]"
        aria-hidden
      >
        {imageSrcs.map((src) => (
          <div key={src} className="relative min-w-0 flex-1 overflow-hidden">
            <img
              src={src}
              alt=""
              className="absolute inset-0 h-full w-[200%] max-w-none -translate-x-1/4 object-cover skew-x-[28deg]"
              draggable={false}
            />
          </div>
        ))}
      </div>
      <div className="absolute inset-0 bg-black/20" aria-hidden />
      <div
        className="relative z-10 flex w-full flex-col items-center justify-center gap-2 px-4 py-10"
        style={{
          filter:
            "drop-shadow(0 1px 0 rgba(0,0,0,1)) drop-shadow(0 2px 3px rgba(0,0,0,0.95)) drop-shadow(0 6px 14px rgba(0,0,0,0.9)) drop-shadow(0 0 18px rgba(0,0,0,0.75))",
        }}
      >
        <span className="text-3xl leading-none text-white" aria-hidden>
          +
        </span>
        <span className="flex flex-wrap items-baseline justify-center gap-x-1.5 text-xl font-semibold text-white">
          <span>{promptPrefix}</span>
          {prompts.length > 0 ? (
            <span className="relative inline-grid text-left">
              <span
                className="invisible col-start-1 row-start-1 whitespace-nowrap underline decoration-2 underline-offset-2"
                aria-hidden
              >
                {promptSizer}
              </span>
              <span
                className="col-start-1 row-start-1 overflow-hidden"
                style={{ height: `${PROMPT_LINE_EM}em` }}
              >
                <span
                  className={`flex flex-col ${
                    promptAnimate ? "transition-transform duration-[450ms] ease-out" : ""
                  }`}
                  style={{
                    transform: `translateY(-${promptIndex * PROMPT_LINE_EM}em)`,
                  }}
                >
                  {promptSlides.map((prompt, slideIndex) => (
                    <span
                      key={`${prompt}-${slideIndex}`}
                      className="block whitespace-nowrap underline decoration-2 underline-offset-2"
                      style={{ height: `${PROMPT_LINE_EM}em` }}
                    >
                      {prompt}
                    </span>
                  ))}
                </span>
              </span>
            </span>
          ) : null}
        </span>
      </div>
    </button>
  );
}
