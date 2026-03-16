"use client";

import { Dispatch, SetStateAction, useCallback, useEffect, useState } from "react";
import { readCacheValue, writeCacheValue } from "@/app/lib/cacheSystem";

type UseStateCachedReturn<T> = [T, Dispatch<SetStateAction<T>>];

export function useStateCached<T>(initialValue: T, cacheKey: string): UseStateCachedReturn<T> {
  const [value, setValue] = useState<T>(initialValue);

  useEffect(() => {
    let isCancelled = false;

    const load = async () => {
      try {
        const cached = await readCacheValue<T>(cacheKey);
        if (!isCancelled && cached !== null && cached !== undefined) {
          setValue(cached);
        }
      } catch {
        // Ignore cache read errors; fall back to initial value.
      }
    };

    void load();

    return () => {
      isCancelled = true;
    };
  }, [cacheKey]);

  const setAndCache = useCallback(
    (updater: SetStateAction<T>) => {
      setValue((previous) => {
        const nextValue =
          typeof updater === "function" ? (updater as (prev: T) => T)(previous) : updater;
        void writeCacheValue(cacheKey, nextValue);
        return nextValue;
      });
    },
    [cacheKey],
  );

  return [value, setAndCache];
}

