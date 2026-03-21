import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";

const TARGET_USER_ID = "74fc2cb5-3df2-4309-8d8a-3c881add7114";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

type AdvertTopic = "politics" | "religion";
type BackgroundKind = "flag" | "cross";

const trimToTwentyWords = (value: string): string =>
  value
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 20)
    .join(" ");

const pickAdvertTheme = (): { topic: AdvertTopic; background_kind: BackgroundKind } => {
  const topic: AdvertTopic = Math.random() < 0.5 ? "politics" : "religion";
  const background_kind: BackgroundKind = Math.random() < 0.5 ? "flag" : "cross";
  return { topic, background_kind };
};

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("advert_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  if (authResult.user_id !== TARGET_USER_ID) {
    return NextResponse.json(
      { error: { code: "forbidden", message: "Advert is not enabled for this user." } },
      { status: 403 },
    );
  }

  const apiKey = process.env.OPEN_AI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: { code: "missing_key", message: "OPEN_AI_API_KEY is not configured." } },
      { status: 500 },
    );
  }

  const { topic, background_kind } = pickAdvertTheme();
  const prompt = [
    "Create one fake satirical ad line.",
    `Topic must be ${topic}.`,
    "Make it dumb and obnoxious, preferably profane and offensive.",
    "Maximum 20 words.",
    "Plain text only.",
    "Do not use quotes, hashtags, emojis, or line breaks.",
  ].join(" ");

  try {
    const openAiResponse = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: "You write very short, absurd ad copy. Make it as offensive and ridiculous as possible. This is a prank for my friends, so make it as offensive as possible.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 1,
      }),
    });

    if (!openAiResponse.ok) {
      const errorText = await openAiResponse.text();
      console.error("advert_openai_failed", openAiResponse.status, errorText);
      return NextResponse.json(
        { error: { code: "openai_failed", message: "Failed to generate fake advert." } },
        { status: 502 },
      );
    }

    const payload = (await openAiResponse.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const rawText = payload.choices?.[0]?.message?.content ?? "";
    const advert_text = trimToTwentyWords(rawText);

    if (!advert_text) {
      return NextResponse.json(
        { error: { code: "empty_advert", message: "No advert text generated." } },
        { status: 502 },
      );
    }

    return NextResponse.json(
      {
        advert_text,
        topic,
        background_kind,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("advert_generation_failed", error);
    return NextResponse.json(
      { error: { code: "advert_generation_failed", message: "Unexpected advert generation failure." } },
      { status: 500 },
    );
  }
}
