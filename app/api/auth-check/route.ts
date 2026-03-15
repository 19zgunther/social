import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";

export async function POST(request: Request) {
  const authResult = authCheck(request);

  if (authResult.error) {
    console.error("auth_check_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  return NextResponse.json(authResult, { status: 200 });
}