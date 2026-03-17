"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { AiAnalyticsChatResponse } from "@/server/ai-analytics/chat";
import type { AiAnalyticsPageData } from "@/server/ai-analytics/workspace";

import { DashboardIcon } from "./org-icons";

type AiAnalyticsClientProps = {
  data: AiAnalyticsPageData;
};

type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
  details?: AiAnalyticsChatResponse;
  isError?: boolean;
};

const scopeOptions = [
  { id: "7d", label: "7D" },
  { id: "14d", label: "14D" },
  { id: "30d", label: "30D" },
  { id: "qtd", label: "QTD" },
  { id: "all", label: "All" },
] as const;

const statNumberFormatter = new Intl.NumberFormat("en-US");
const statDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function formatStatDate(value: string | null) {
  if (!value) {
    return "--";
  }

  const parsedDate = new Date(value);

  return Number.isNaN(parsedDate.getTime()) ? "--" : statDateFormatter.format(parsedDate);
}

function createMessageId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function buildInitialAssistantMessage(data: AiAnalyticsPageData): ChatMessage {
  if (!data.isAiConfigured) {
    return {
      id: "assistant-setup",
      role: "assistant",
      content:
        "AI analytics is wired up, but it still needs `OPENAI_API_KEY` before I can start answering database questions from this page.",
      isError: true,
    };
  }

  if (!data.hasDataAccess) {
    return {
      id: "assistant-no-access",
      role: "assistant",
      content:
        "You do not have access to any campaign-scoped analytics in this organization yet, so I cannot query video or campaign data for you from here.",
      isError: true,
    };
  }

  return {
    id: "assistant-welcome",
    role: "assistant",
    content:
      "Ask anything about videos, campaigns, or creators. I’ll turn your question into a scoped analytics query, run it against the database, and summarize the result here.",
  };
}

export function AiAnalyticsClient({ data }: AiAnalyticsClientProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    buildInitialAssistantMessage(data),
  ]);
  const [prompt, setPrompt] = useState("");
  const [selectedRange, setSelectedRange] = useState<string>("30d");
  const [isLoading, setIsLoading] = useState(false);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const accessibleCampaignIds = useMemo(
    () => data.accessibleCampaigns.map((campaign) => campaign.id),
    [data.accessibleCampaigns],
  );
  const canSubmit = data.isAiConfigured && data.hasDataAccess && !isLoading;

  useEffect(() => {
    if (!transcriptRef.current) {
      return;
    }

    transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
  }, [messages, isLoading]);

  async function submitPrompt(rawPrompt: string) {
    const trimmedPrompt = rawPrompt.trim();

    if (!trimmedPrompt || !canSubmit) {
      return;
    }

    const nextUserMessage: ChatMessage = {
      id: createMessageId(),
      role: "user",
      content: trimmedPrompt,
    };
    const priorConversation = messages.map((message) => ({
      role: message.role,
      content: message.content,
    }));

    setMessages((current) => [...current, nextUserMessage]);
    setPrompt("");
    setIsLoading(true);

    try {
      const response = await fetch(
        `/api/org/${data.organizationSlug}/ai-analytics`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            prompt: trimmedPrompt,
            messages: priorConversation,
            selectedCampaignIds: accessibleCampaignIds,
            selectedDateRange: selectedRange,
          }),
        },
      );
      const payload = (await response.json()) as
        | AiAnalyticsChatResponse
        | { error?: string };

      if (!response.ok) {
        throw new Error(
          typeof payload === "object" && payload && "error" in payload
            ? payload.error
            : "The AI analytics request failed.",
        );
      }

      const result = payload as AiAnalyticsChatResponse;

      setMessages((current) => [
        ...current,
        {
          id: createMessageId(),
          role: "assistant",
          content: result.answer,
          details: result,
        },
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: createMessageId(),
          role: "assistant",
          content:
            error instanceof Error
              ? error.message
              : "The AI analytics request failed.",
          isError: true,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  function handlePromptSubmit() {
    void submitPrompt(prompt);
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_22rem]">
      <div className="space-y-4">
        <section className="rounded-[1.7rem] border border-white/[0.08] bg-[linear-gradient(135deg,rgba(255,255,255,0.05),rgba(144,255,77,0.06),rgba(255,255,255,0.02))] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.25)]">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-[0.68rem] uppercase tracking-[0.26em] text-muted-foreground">
                AI analytics workspace
              </p>
              <h1 className="mt-3 text-[2rem] font-medium tracking-[-0.05em] text-foreground sm:text-[2.35rem]">
                Query your videos and campaigns in plain English.
              </h1>
              <p className="mt-3 max-w-2xl text-[0.96rem] leading-7 text-muted-foreground">
                Ask for top videos, campaign rankings, creator performance, publishing
                counts, or trend breakdowns. The assistant turns each prompt into a
                scoped analytics query and answers with the live result.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-white/[0.08] bg-black/[0.22] px-3 py-1.5 text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground">
                Org scoped
              </span>
              <span className="rounded-full border border-white/[0.08] bg-black/[0.22] px-3 py-1.5 text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground">
                Database backed
              </span>
              <span
                className={`rounded-full border px-3 py-1.5 text-[0.62rem] uppercase tracking-[0.2em] ${
                  data.isAiConfigured
                    ? "border-[#90FF4D]/25 bg-[#90FF4D]/10 text-[#B8FF86]"
                    : "border-[#FF9D7A]/25 bg-[#FF7E54]/10 text-[#FFB39A]"
                }`}
              >
                {data.isAiConfigured ? "AI ready" : "Needs API key"}
              </span>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              icon="videos"
              label="Tracked videos"
              value={statNumberFormatter.format(data.stats.trackedVideos)}
            />
            <StatCard
              icon="campaigns"
              label="Accessible campaigns"
              value={statNumberFormatter.format(data.stats.accessibleCampaigns)}
            />
            <StatCard
              icon="creators"
              label="Accessible creators"
              value={statNumberFormatter.format(data.stats.accessibleCreators)}
            />
            <StatCard
              icon="calendar"
              label="Latest published video"
              value={formatStatDate(data.stats.latestPublishedAt)}
            />
          </div>
        </section>

        <section className="rounded-[1.6rem] border border-white/[0.08] bg-white/[0.03] p-4 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur sm:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-[0.68rem] uppercase tracking-[0.26em] text-muted-foreground">
                Scope
              </p>
              <p className="mt-1.5 text-[0.92rem] text-muted-foreground">
                The selected range is the default scope for questions unless you ask
                for a different time window explicitly.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {scopeOptions.map((option) => {
                const isActive = selectedRange === option.id;

                return (
                  <button
                    key={option.id}
                    className={`rounded-full border px-3 py-1.5 text-[0.82rem] transition ${
                      isActive
                        ? "border-white/[0.16] bg-white/[0.1] text-foreground"
                        : "border-white/[0.08] bg-white/[0.04] text-muted-foreground hover:border-white/[0.14] hover:bg-white/[0.07] hover:text-foreground"
                    }`}
                    onClick={() => setSelectedRange(option.id)}
                    type="button"
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-[1.7rem] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(0,0,0,0.14))] shadow-[0_24px_80px_rgba(0,0,0,0.24)]">
          <div className="border-b border-white/[0.08] px-4 py-4 sm:px-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[0.68rem] uppercase tracking-[0.26em] text-muted-foreground">
                  Conversation
                </p>
                <p className="mt-1.5 text-[0.92rem] text-muted-foreground">
                  Ask a question, inspect the generated query, and review the returned
                  rows without leaving the page.
                </p>
              </div>

              <button
                className="inline-flex min-h-10 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.04] px-4 py-2 text-[0.88rem] text-muted-foreground transition hover:border-white/[0.14] hover:bg-white/[0.07] hover:text-foreground"
                onClick={() => setMessages([buildInitialAssistantMessage(data)])}
                type="button"
              >
                Clear chat
              </button>
            </div>
          </div>

          <div
            ref={transcriptRef}
            className="flex max-h-[48rem] min-h-[34rem] flex-col gap-3 overflow-y-auto px-4 py-4 sm:px-5"
          >
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}

            {isLoading ? (
              <div className="max-w-3xl rounded-[1.2rem] border border-white/[0.08] bg-black/[0.22] px-4 py-3 text-[0.92rem] text-muted-foreground">
                Interpreting your question, building the query, and reading the
                database...
              </div>
            ) : null}
          </div>

          <div className="border-t border-white/[0.08] bg-black/[0.12] px-4 py-4 sm:px-5">
            <div className="rounded-[1.35rem] border border-white/[0.08] bg-[#09090b] p-3.5">
              <textarea
                className="min-h-28 w-full resize-none bg-transparent text-[0.95rem] leading-7 text-foreground outline-none placeholder:text-muted-foreground"
                disabled={!canSubmit}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    handlePromptSubmit();
                  }
                }}
                placeholder={
                  data.isAiConfigured
                    ? "Ask about videos, campaigns, creators, platforms, or trends..."
                    : "Add OPENAI_API_KEY to enable the AI chat."
                }
                value={prompt}
              />

              <div className="mt-3 flex flex-col gap-3 border-t border-white/[0.08] pt-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap gap-2">
                  {data.samplePrompts.map((samplePrompt) => (
                    <button
                      key={samplePrompt}
                      className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-left text-[0.78rem] text-muted-foreground transition hover:border-white/[0.14] hover:bg-white/[0.07] hover:text-foreground"
                      disabled={!canSubmit}
                      onClick={() => {
                        void submitPrompt(samplePrompt);
                      }}
                      type="button"
                    >
                      {samplePrompt}
                    </button>
                  ))}
                </div>

                <button
                  className={`inline-flex min-h-11 items-center justify-center rounded-full px-5 py-2.5 text-[0.92rem] font-medium transition ${
                    canSubmit
                      ? "bg-[linear-gradient(135deg,#B8FF86,#90FF4D)] text-black hover:brightness-105"
                      : "cursor-not-allowed bg-white/[0.08] text-muted-foreground"
                  }`}
                  disabled={!canSubmit}
                  onClick={handlePromptSubmit}
                  type="button"
                >
                  Send query
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>

      <aside className="space-y-4">
        <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-4 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur sm:p-5">
          <p className="text-[0.68rem] uppercase tracking-[0.26em] text-muted-foreground">
            How it works
          </p>
          <div className="mt-4 space-y-2.5">
            <StepRow
              title="Interpret"
              description="The assistant reads your question and turns it into a structured analytics query."
            />
            <StepRow
              title="Query"
              description="The server runs that query against org-scoped video and campaign data with permission-aware filters."
            />
            <StepRow
              title="Answer"
              description="You get a direct reply, the generated query text, summary cards, and the returned rows."
            />
          </div>
        </section>

        <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-4 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur sm:p-5">
          <p className="text-[0.68rem] uppercase tracking-[0.26em] text-muted-foreground">
            Ask about
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {[
              "Top videos",
              "Campaign rankings",
              "Creator performance",
              "Platform splits",
              "Publishing counts",
              "Time trends",
            ].map((item) => (
              <span
                key={item}
                className="rounded-full border border-white/[0.08] bg-black/[0.22] px-2.5 py-1.5 text-[0.68rem] uppercase tracking-[0.18em] text-muted-foreground"
              >
                {item}
              </span>
            ))}
          </div>
        </section>

        <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-4 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur sm:p-5">
          <p className="text-[0.68rem] uppercase tracking-[0.26em] text-muted-foreground">
            Campaign scope
          </p>
          <p className="mt-2 text-[0.9rem] leading-6 text-muted-foreground">
            These campaigns are available in your current org scope.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {data.accessibleCampaigns.length > 0 ? (
              data.accessibleCampaigns.slice(0, 10).map((campaign) => (
                <span
                  key={campaign.id}
                  className="rounded-full border border-white/[0.08] bg-black/[0.22] px-2.5 py-1.5 text-[0.76rem] text-foreground"
                >
                  {campaign.name}
                </span>
              ))
            ) : (
              <span className="text-[0.92rem] text-muted-foreground">
                No campaigns yet.
              </span>
            )}
            {data.accessibleCampaigns.length > 10 ? (
              <span className="rounded-full border border-white/[0.08] bg-black/[0.22] px-2.5 py-1.5 text-[0.76rem] text-muted-foreground">
                +{data.accessibleCampaigns.length - 10} more
              </span>
            ) : null}
          </div>
        </section>
      </aside>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: "videos" | "campaigns" | "creators" | "calendar";
}) {
  return (
    <article className="rounded-[1.2rem] border border-white/[0.08] bg-black/[0.18] p-3.5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[0.66rem] uppercase tracking-[0.22em] text-muted-foreground">
          {label}
        </p>
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-[0.9rem] border border-white/[0.08] bg-white/[0.04] text-foreground">
          <DashboardIcon className="h-3.5 w-3.5" name={icon} />
        </span>
      </div>
      <p className="mt-3 text-[1.55rem] font-medium tracking-[-0.05em] text-foreground">
        {value}
      </p>
    </article>
  );
}

function StepRow({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-[1.05rem] border border-white/[0.08] bg-black/[0.18] p-3.5">
      <p className="text-[0.9rem] font-medium text-foreground">{title}</p>
      <p className="mt-1.5 text-[0.86rem] leading-6 text-muted-foreground">
        {description}
      </p>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-2xl rounded-[1.2rem] border border-white/[0.08] bg-white text-black px-4 py-3">
          <p className="text-[0.92rem] leading-7 whitespace-pre-wrap">
            {message.content}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <article
        className={`max-w-3xl rounded-[1.3rem] border px-4 py-4 shadow-[0_18px_40px_rgba(0,0,0,0.16)] ${
          message.isError
            ? "border-[#FF7E54]/20 bg-[#FF7E54]/10"
            : "border-white/[0.08] bg-black/[0.22]"
        }`}
      >
        <p className="text-[0.95rem] leading-7 whitespace-pre-wrap text-foreground">
          {message.content}
        </p>

        {message.details?.warnings.length ? (
          <div className="mt-4 rounded-[1rem] border border-[#FFB479]/20 bg-[#FFB479]/10 px-3.5 py-3 text-[0.84rem] leading-6 text-[#FFD6AF]">
            {message.details.warnings.join(" ")}
          </div>
        ) : null}

        {message.details?.summaryCards.length ? (
          <div className="mt-4 grid gap-2.5 sm:grid-cols-3">
            {message.details.summaryCards.map((card) => (
              <div
                key={`${card.label}-${card.value}`}
                className="rounded-[1rem] border border-white/[0.08] bg-white/[0.03] px-3.5 py-3"
              >
                <p className="text-[0.6rem] uppercase tracking-[0.22em] text-muted-foreground">
                  {card.label}
                </p>
                <p className="mt-2 text-[1rem] font-medium text-foreground">
                  {card.value}
                </p>
                {card.hint ? (
                  <p className="mt-1 text-[0.78rem] text-muted-foreground">{card.hint}</p>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        {message.details?.generatedQuery ? (
          <div className="mt-4">
            <p className="text-[0.62rem] uppercase tracking-[0.22em] text-muted-foreground">
              {message.details.queryLabel ?? "Generated query"}
            </p>
            <pre className="mt-2 overflow-x-auto rounded-[1rem] border border-white/[0.08] bg-[#09090b] px-3.5 py-3 text-[0.78rem] leading-6 text-[#BDEBFF]">
              {message.details.generatedQuery}
            </pre>
          </div>
        ) : null}

        {message.details?.table ? <ResponseTable table={message.details.table} /> : null}
      </article>
    </div>
  );
}

function ResponseTable({
  table,
}: {
  table: NonNullable<AiAnalyticsChatResponse["table"]>;
}) {
  if (table.rows.length === 0) {
    return (
      <div className="mt-4 rounded-[1rem] border border-dashed border-white/[0.08] bg-white/[0.03] px-4 py-6 text-[0.9rem] text-muted-foreground">
        No rows matched this query.
      </div>
    );
  }

  return (
    <div className="mt-4 overflow-hidden rounded-[1rem] border border-white/[0.08]">
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse text-left">
          <thead className="bg-white/[0.04]">
            <tr>
              {table.columns.map((column) => (
                <th
                  key={column.key}
                  className="border-b border-white/[0.08] px-3.5 py-3 text-[0.64rem] uppercase tracking-[0.22em] text-muted-foreground"
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, index) => (
              <tr key={`${index}-${row[table.columns[0]?.key ?? ""] ?? "row"}`}>
                {table.columns.map((column) => {
                  const value = row[column.key];
                  const isLink = column.key === "link" && value;

                  return (
                    <td
                      key={`${index}-${column.key}`}
                      className="border-b border-white/[0.06] px-3.5 py-3 text-[0.88rem] text-foreground"
                    >
                      {isLink ? (
                        <a
                          className="inline-flex items-center gap-1 text-[#BDEBFF] transition hover:text-white"
                          href={value ?? undefined}
                          rel="noreferrer"
                          target="_blank"
                        >
                          Open
                          <DashboardIcon className="h-3.5 w-3.5" name="externalLink" />
                        </a>
                      ) : (
                        <span className="whitespace-nowrap">{value ?? "--"}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
