import { NextResponse } from "next/server";
import { Resend } from "resend";
import { prisma } from "@/app/lib/prisma";
import type { TempLoginEmailRequest, TempLoginEmailResponse } from "@/app/types/interfaces";

const TEMP_LOGIN_TTL_MS = 30 * 60 * 1000;

/** Same response whether or not we found a user / sent mail (avoid account enumeration). */
const GENERIC_SUCCESS_MESSAGE =
  "If an account exists for that login, we sent a temporary sign-in code to its email address.";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function POST(request: Request) {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: { code: "email_unavailable", message: "Email sign-in is not configured." } },
        { status: 503 },
      );
    }

    const body = (await request.json()) as TempLoginEmailRequest;
    const identifier = body.identifier?.trim() ?? "";

    if (!identifier) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "Username or email is required." } },
        { status: 400 },
      );
    }

    const user = await prisma.users.findFirst({
      where: {
        OR: [{ username: identifier }, { email: identifier.toLowerCase() }],
      },
      select: { id: true, username: true, email: true },
    });

    const origin = new URL(request.url).origin;

    if (user?.email) {
      const row = await prisma.temp_passwords.create({
        data: {
          user_id: user.id,
          expires_at: new Date(Date.now() + TEMP_LOGIN_TTL_MS),
          was_used: false,
        },
      });

      const loginUrl = `${origin}/?temp_password=${encodeURIComponent(row.id)}`;
      const from = process.env.RESEND_FROM ?? "Social <youforgotyourpassword@zgunther.com>";

      const resend = new Resend(apiKey);
      try {
        const { error } = await resend.emails.send({
          from,
          to: user.email,
          subject: "Your temporary sign-in code",
          html: `
<p>Hi ${escapeHtml(user.username)},</p>
<p>Use this one-time code as your password when you sign in. It expires in 30 minutes and can only be used once.</p>
<p style="font-size:14px;font-family:ui-monospace,monospace;word-break:break-all">${escapeHtml(row.id)}</p>
<p><a href="${loginUrl}">Open the app and sign in</a></p>
<p>If you did not request this, you can ignore this email.</p>
`.trim(),
        });
        if (error) {
          throw new Error(error.message);
        }
      } catch (sendErr) {
        await prisma.temp_passwords.delete({ where: { id: row.id } }).catch(() => {});
        throw sendErr;
      }
    }

    const payload: TempLoginEmailResponse = { message: GENERIC_SUCCESS_MESSAGE };
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("temp_login_email_failed", error);
    return NextResponse.json(
      { error: { code: "email_failed", message: "Could not send the email. Try again later." } },
      { status: 500 },
    );
  }
}
