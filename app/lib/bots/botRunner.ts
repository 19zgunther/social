import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/app/lib/prisma";
import { createPostForUser } from "@/app/lib/createPostForUser";
import { fetchRssFeeds } from "@/app/lib/bots/fetchRss";
import { parseRssFeedsJson } from "@/app/lib/bots/botHelpers";

const OPENAI_MODEL = "gpt-4o-mini";
const MAX_TOOL_STEPS = 8;
/** Approximate billed-token budget per wake (sum of OpenAI usage.total_tokens across steps). */
const MAX_TOKENS_PER_WAKE = 2_000_000;
/** Hard wall-clock limit so a wake cannot hang indefinitely. */
const MAX_WAKE_DURATION_MS = 90_000;
/** Cap assistant completion size per step. */
const MAX_COMPLETION_TOKENS = 2_048;
/** Keep tool payloads from exploding the context window. */
const MAX_TOOL_RESULT_CHARS = 24_000;

const TOOLS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "fetch_rss",
      description:
        "Fetch recent items from one or more RSS feeds. If urls is omitted, uses the bot's configured feeds.",
      parameters: {
        type: "object",
        properties: {
          urls: {
            type: "array",
            items: { type: "string" },
            description: "Optional list of RSS feed URLs to fetch.",
          },
          url: {
            type: "string",
            description: "Optional single RSS feed URL to fetch.",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_my_posts",
      description:
        "List this bot's recent posts (newest first). Use only to avoid repeating the same stories/topics. Do NOT copy the formatting or layout of older posts — follow the current formatting rules instead.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "integer",
            description: "Max posts to return (1–30). Defaults to 10.",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_post",
      description: "Create a text-only permanent post as this bot user.",
      parameters: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description:
              "Post body. Exact collapse syntax (required when the job asks for collapsible sections): a line `:::collapse Title`, then body lines, then a line that is only `:::`. Also supports **bold** and *italic*. Paste raw https:// URLs (they are linkified); do not use markdown [text](url) links. Do not invent other fence variants such as bare `:::`.",
          },
        },
        required: ["text"],
        additionalProperties: false,
      },
    },
  },
];

const POST_FORMATTING_SYSTEM_APPENDIX =
  `Post text formatting rules (mandatory; override any older post style you see):\n` +
  `- **bold** and *italic* only (no headings, no markdown links).\n` +
  `- Paste raw https:// URLs; they become clickable automatically. Never write [Read more](https://...).\n` +
  `- Collapsible sections MUST use this exact fence (nothing else counts as collapse):\n` +
  `:::collapse Story title here\n` +
  `3–6 sentences of detail and a raw https:// link\n` +
  `:::\n` +
  `- Example multi-story post:\n` +
  `Today's AI roundup:\n` +
  `\n` +
  `:::collapse Disney hires Character.AI staff\n` +
  `Disney agreed to hire most of Character.AI's workforce under a stalking-horse bid. Competing offers could still emerge. https://techcrunch.com/example\n` +
  `:::\n` +
  `\n` +
  `:::collapse Anthropic public benefit fund\n` +
  `Anthropic said it will commit 5% of its shares to a public benefit fund. https://techcrunch.com/example2\n` +
  `:::\n` +
  `- If your job asks for collapsible story sections, every story must be wrapped in :::collapse … ::: as above. Numbered lists alone are not enough.`;

function parseToolArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  return {};
}

function stringifyToolResult(result: unknown): string {
  const raw = JSON.stringify(result);
  if (raw.length <= MAX_TOOL_RESULT_CHARS) {
    return raw;
  }
  return JSON.stringify({
    truncated: true,
    original_chars: raw.length,
    preview: raw.slice(0, MAX_TOOL_RESULT_CHARS),
  });
}

async function persistMessages(logId: string, messages: ChatCompletionMessageParam[]) {
  await prisma.bot_logs.update({
    where: { id: logId },
    data: {
      messages: messages as unknown as Prisma.InputJsonValue,
    },
  });
}

export async function runBotWake(input: {
  botId: string;
}): Promise<{ log_id: string; status: "completed" | "failed"; error?: string }> {
  const bot = await prisma.bots.findFirst({
    where: { id: input.botId },
    select: {
      id: true,
      user_id: true,
      system_prompt: true,
      rss_feeds: true,
      users_bot: {
        select: {
          id: true,
          username: true,
          email: true,
        },
      },
    },
  });

  if (!bot) {
    throw new Error("Bot not found.");
  }

  const configuredFeeds = parseRssFeedsJson(bot.rss_feeds);
  const defaultSystemPrompt =
    bot.system_prompt.trim() ||
    "You are a helpful personal bot";
  const systemPrompt = `${defaultSystemPrompt}\n\n${POST_FORMATTING_SYSTEM_APPENDIX}`;

  const wakeMessage =
    `Wake up and do your job.\n` +
    `Configured RSS feeds (${configuredFeeds.length}):\n` +
    (configuredFeeds.length > 0
      ? configuredFeeds.map((url) => `- ${url}`).join("\n")
      : "- (none configured)") +
    `\nUse list_my_posts, fetch_rss, and/or create_post as needed. Check recent posts before creating a new one (for topic overlap only — do not copy their formatting). Prefer at most one post per wake. When posting, use the exact :::collapse Title / ::: fences from the formatting rules; numbered **bold** lists without collapses are wrong if your job asks for collapsible sections.`;

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: wakeMessage },
  ];

  const log = await prisma.bot_logs.create({
    data: {
      bot_id: bot.id,
      status: "running",
      messages: messages as unknown as Prisma.InputJsonValue,
    },
    select: { id: true },
  });

  const apiKey = process.env.OPEN_AI_API_KEY?.trim();
  if (!apiKey) {
    const error = "OPEN_AI_API_KEY is not configured.";
    await prisma.bot_logs.update({
      where: { id: log.id },
      data: {
        status: "failed",
        error,
        finished_at: new Date(),
      },
    });
    return { log_id: log.id, status: "failed", error };
  }

  const openai = new OpenAI({ apiKey });
  const wakeStartedAt = Date.now();
  let tokensUsed = 0;
  let stopReason: string | null = null;

  try {
    for (let step = 0; step < MAX_TOOL_STEPS; step += 1) {
      const elapsedMs = Date.now() - wakeStartedAt;
      if (tokensUsed >= MAX_TOKENS_PER_WAKE) {
        stopReason = `Stopped: token budget reached (${tokensUsed.toLocaleString()} / ${MAX_TOKENS_PER_WAKE.toLocaleString()}).`;
        break;
      }
      if (elapsedMs >= MAX_WAKE_DURATION_MS) {
        stopReason = `Stopped: wake time limit reached (${Math.round(MAX_WAKE_DURATION_MS / 1000)}s).`;
        break;
      }

      const completion = await openai.chat.completions.create({
        model: OPENAI_MODEL,
        messages,
        tools: TOOLS,
        tool_choice: "auto",
        max_tokens: MAX_COMPLETION_TOKENS,
      });

      tokensUsed += completion.usage?.total_tokens ?? 0;

      const choice = completion.choices[0]?.message;
      if (!choice) {
        throw new Error("OpenAI returned an empty response.");
      }

      const assistantMessage: ChatCompletionMessageParam = {
        role: "assistant",
        content: choice.content ?? null,
        ...(choice.tool_calls && choice.tool_calls.length > 0
          ? { tool_calls: choice.tool_calls }
          : {}),
      };
      messages.push(assistantMessage);
      await persistMessages(log.id, messages);

      if (tokensUsed >= MAX_TOKENS_PER_WAKE) {
        stopReason = `Stopped: token budget reached (${tokensUsed.toLocaleString()} / ${MAX_TOKENS_PER_WAKE.toLocaleString()}).`;
        break;
      }

      const toolCalls = choice.tool_calls ?? [];
      if (toolCalls.length === 0) {
        break;
      }

      for (const toolCall of toolCalls) {
        if (toolCall.type !== "function") {
          continue;
        }
        if (Date.now() - wakeStartedAt >= MAX_WAKE_DURATION_MS) {
          stopReason = `Stopped: wake time limit reached (${Math.round(MAX_WAKE_DURATION_MS / 1000)}s).`;
          break;
        }

        const name = toolCall.function.name;
        const args = parseToolArgs(toolCall.function.arguments ?? "{}");
        let toolResult: unknown;

        if (name === "fetch_rss") {
          const urlsFromArgs: string[] = [];
          if (typeof args.url === "string" && args.url.trim()) {
            urlsFromArgs.push(args.url.trim());
          }
          if (Array.isArray(args.urls)) {
            for (const entry of args.urls) {
              if (typeof entry === "string" && entry.trim()) {
                urlsFromArgs.push(entry.trim());
              }
            }
          }
          const urls = urlsFromArgs.length > 0 ? urlsFromArgs : configuredFeeds;
          if (urls.length === 0) {
            toolResult = {
              items: [],
              errors: [{ url: "", message: "No RSS feed URLs configured or provided." }],
            };
          } else {
            toolResult = await fetchRssFeeds(urls);
          }
        } else if (name === "list_my_posts") {
          const rawLimit = typeof args.limit === "number" ? args.limit : 10;
          const limit = Math.min(30, Math.max(1, Math.floor(rawLimit) || 10));
          const posts = await prisma.posts.findMany({
            where: { created_by: bot.users_bot.id },
            orderBy: { created_at: "desc" },
            take: limit,
            select: {
              id: true,
              created_at: true,
              text: true,
            },
          });
          toolResult = {
            posts: posts.map((post) => ({
              id: post.id,
              created_at: post.created_at.toISOString(),
              text: post.text ?? "",
            })),
          };
        } else if (name === "create_post") {
          const text = typeof args.text === "string" ? args.text.trim() : "";
          if (!text) {
            toolResult = { ok: false, error: "text is required." };
          } else {
            const result = await createPostForUser({
              authorUserId: bot.users_bot.id,
              authorUsername: bot.users_bot.username,
              authorEmail: bot.users_bot.email,
              body: {
                text,
                audience: { mode: "permanent" },
              },
            });
            if (!result.ok) {
              toolResult = { ok: false, error: result.error };
            } else {
              toolResult = {
                ok: true,
                post_id: result.response.post.id,
                text: result.response.post.text,
              };
            }
          }
        } else {
          toolResult = { ok: false, error: `Unknown tool: ${name}` };
        }

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: stringifyToolResult(toolResult),
        });
        await persistMessages(log.id, messages);
      }

      if (stopReason) {
        break;
      }
    }

    messages.push({
      role: "system",
      content:
        `Wake usage: ${tokensUsed.toLocaleString()} tokens` +
        ` (budget ${MAX_TOKENS_PER_WAKE.toLocaleString()}),` +
        ` ${Math.round((Date.now() - wakeStartedAt) / 1000)}s elapsed.` +
        (stopReason ? ` ${stopReason}` : ""),
    });

    const finishedAt = new Date();
    await prisma.$transaction([
      prisma.bot_logs.update({
        where: { id: log.id },
        data: {
          status: "completed",
          finished_at: finishedAt,
          messages: messages as unknown as Prisma.InputJsonValue,
          error: stopReason,
        },
      }),
      prisma.bots.update({
        where: { id: bot.id },
        data: {
          last_woke_at: finishedAt,
          updated_at: finishedAt,
        },
      }),
    ]);

    return {
      log_id: log.id,
      status: "completed",
      ...(stopReason ? { error: stopReason } : {}),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bot wake failed.";
    messages.push({
      role: "system",
      content: `Wake failed after ${tokensUsed.toLocaleString()} tokens, ${Math.round((Date.now() - wakeStartedAt) / 1000)}s. ${message}`,
    });
    await prisma.bot_logs.update({
      where: { id: log.id },
      data: {
        status: "failed",
        error: message,
        finished_at: new Date(),
        messages: messages as unknown as Prisma.InputJsonValue,
      },
    });
    return { log_id: log.id, status: "failed", error: message };
  }
}
