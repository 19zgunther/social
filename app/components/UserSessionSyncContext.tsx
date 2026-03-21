"use client";

import { createContext, useMemo, type ReactNode } from "react";
import { useUserSessionSync } from "@/app/components/utils/userSessionSync";

export type UserSessionSyncContextValue = {
  lastActiveByUserId: Record<string, number | null>;
  nowMs: number;
};

export const UserSessionSyncContext = createContext<UserSessionSyncContextValue | null>(null);

export function UserSessionSyncProvider({
  children,
  currentUserId,
}: {
  children: ReactNode;
  currentUserId: string;
}) {
  const { lastActiveByUserId, nowMs } = useUserSessionSync(currentUserId);
  const value = useMemo(
    () => ({ lastActiveByUserId, nowMs }),
    [lastActiveByUserId, nowMs],
  );

  return <UserSessionSyncContext.Provider value={value}>{children}</UserSessionSyncContext.Provider>;
}
