"use client";

import { useEffect, useState } from "react";

/** Bundled defaults used as diagonal slices on the empty-state create button. */
const CREATE_EVENT_COLLAGE_KEYS = [
  "party_1",
  "hike_1",
  "drinks_2",
  "dance_party_1",
  "ski_1",
  "movie_1",
  "halloween",
  "christmas_2",
] as const;

const CREATE_EVENT_PROMPTS = [
  "movie night",
  "house party",
  "camping trip",
  "hiking trip",
  "ski trip",
  "get together",
  // "debaucherous evening",
] as const;

const CREATE_EVENT_PROMPT_INTERVAL_MS = 2000;
const CREATE_EVENT_PROMPT_SLIDE_MS = 450;
const CREATE_EVENT_PROMPT_LINE_EM = 1.35;
const CREATE_EVENT_PROMPT_SLIDES = [...CREATE_EVENT_PROMPTS, CREATE_EVENT_PROMPTS[0]] as const;
const CREATE_EVENT_PROMPT_SIZER = [...CREATE_EVENT_PROMPTS].sort((a, b) => a.length - b.length)[0];

type CreateEventButtonProps = {
  onClick: () => void;
};

export default function CreateEventButton({ onClick }: CreateEventButtonProps) {
  const [promptIndex, setPromptIndex] = useState(0);
  const [promptAnimate, setPromptAnimate] = useState(true);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setPromptIndex((previous) => previous + 1);
    }, CREATE_EVENT_PROMPT_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (promptIndex < CREATE_EVENT_PROMPTS.length) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setPromptAnimate(false);
      setPromptIndex(0);
    }, CREATE_EVENT_PROMPT_SLIDE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [promptIndex]);

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
      aria-label="Create event"
      className="create-post-rgb-border relative flex min-h-[40vw] w-full overflow-hidden rounded-2xl font-semibold shadow-sm"
    >
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 flex h-[170%] w-[190%] -translate-x-1/2 -translate-y-1/2 skew-x-[-28deg]"
        aria-hidden
      >
        {CREATE_EVENT_COLLAGE_KEYS.map((key) => (
          <div key={key} className="relative min-w-0 flex-1 overflow-hidden">
            <img
              src={`/api/default-event-images/${encodeURIComponent(key)}`}
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
          <span>Plan your next</span>
          <span className="relative inline-grid text-left">
            <span
              className="invisible col-start-1 row-start-1 whitespace-nowrap underline decoration-2 underline-offset-2"
              aria-hidden
            >
              {CREATE_EVENT_PROMPT_SIZER}
            </span>
            <span
              className="col-start-1 row-start-1 overflow-hidden"
              style={{ height: `${CREATE_EVENT_PROMPT_LINE_EM}em` }}
            >
              <span
                className={`flex flex-col ${
                  promptAnimate ? "transition-transform duration-[450ms] ease-out" : ""
                }`}
                style={{
                  transform: `translateY(-${promptIndex * CREATE_EVENT_PROMPT_LINE_EM}em)`,
                }}
              >
                {CREATE_EVENT_PROMPT_SLIDES.map((prompt, slideIndex) => (
                  <span
                    key={`${prompt}-${slideIndex}`}
                    className="block whitespace-nowrap underline decoration-2 underline-offset-2"
                    style={{ height: `${CREATE_EVENT_PROMPT_LINE_EM}em` }}
                  >
                    {prompt}
                  </span>
                ))}
              </span>
            </span>
          </span>
        </span>
      </div>
    </button>
  );
}
