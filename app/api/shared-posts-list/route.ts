import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import {
  getSharedPostPhase,
  serializeSharedPostListItem,
  sharedPostSelectForSerialize,
} from "@/app/lib/sharedPosts";
import type {
  SharedPostPhase,
  SharedPostsListRequest,
  SharedPostsListResponse,
} from "@/app/types/interfaces";

const DEFAULT_PHASES: SharedPostPhase[] = ["open", "pending"];
const ALL_PHASES: SharedPostPhase[] = ["open", "pending", "released"];

const parsePhases = (body: SharedPostsListRequest): Set<SharedPostPhase> => {
  if (!Array.isArray(body.phases) || body.phases.length === 0) {
    return new Set(DEFAULT_PHASES);
  }
  const allowed = new Set<SharedPostPhase>(ALL_PHASES);
  const selected = body.phases.filter((phase): phase is SharedPostPhase => allowed.has(phase));
  return new Set(selected.length > 0 ? selected : DEFAULT_PHASES);
};

/** Prisma date filter so we only load rows that can land in the requested phases. */
const phaseDateWhere = (phases: Set<SharedPostPhase>, now: Date) => {
  const wantsOpen = phases.has("open");
  const wantsPending = phases.has("pending");
  const wantsReleased = phases.has("released");

  if (wantsOpen && wantsPending && wantsReleased) {
    return {};
  }
  if (wantsOpen && wantsPending) {
    return { release_at: { gt: now } };
  }
  if (wantsPending && wantsReleased) {
    return { close_at: { lte: now } };
  }
  if (wantsOpen && wantsReleased) {
    return {
      OR: [{ close_at: { gt: now } }, { release_at: { lte: now } }],
    };
  }
  if (wantsOpen) {
    return { close_at: { gt: now } };
  }
  if (wantsPending) {
    return { close_at: { lte: now }, release_at: { gt: now } };
  }
  if (wantsReleased) {
    return { release_at: { lte: now } };
  }
  return { id: { in: [] as string[] } };
};

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("shared_posts_list_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    let body: SharedPostsListRequest = {};
    try {
      body = (await request.json()) as SharedPostsListRequest;
    } catch {
      body = {};
    }

    const phases = parsePhases(body);
    const now = new Date();

    const rows = await prisma.shared_posts.findMany({
      where: {
        shared_posts_contributors: {
          some: { user_id: authResult.user_id },
        },
        ...phaseDateWhere(phases, now),
      },
      orderBy: [{ release_at: "desc" }, { created_at: "desc" }],
      select: sharedPostSelectForSerialize,
    });

    const payload: SharedPostsListResponse = {
      open: [],
      pending: [],
      released: [],
    };

    for (const row of rows) {
      const phase = getSharedPostPhase(row.close_at, row.release_at, now);
      if (!phases.has(phase)) {
        continue;
      }
      const item = serializeSharedPostListItem({
        row,
        viewerUserId: authResult.user_id,
      });
      if (phase === "open") {
        payload.open.push(item);
      } else if (phase === "pending") {
        payload.pending.push(item);
      } else {
        payload.released.push(item);
      }
    }

    payload.open.sort((a, b) => b.close_at.localeCompare(a.close_at));
    payload.pending.sort((a, b) => a.release_at.localeCompare(b.release_at));
    payload.released.sort((a, b) => b.release_at.localeCompare(a.release_at));

    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("shared_posts_list_failed", error);
    return NextResponse.json(
      { error: { code: "shared_posts_list_failed", message: "Failed to load shared posts." } },
      { status: 500 },
    );
  }
}
