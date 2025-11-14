// @ts-nocheck

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChatKit, useChatKit } from "@openai/chatkit-react";
import {
  STARTER_PROMPTS,
  PLACEHOLDER_INPUT,
  GREETING,
  CREATE_SESSION_ENDPOINT,
  WORKFLOW_ID,
  getThemeConfig,
} from "@/lib/config";
import { ErrorOverlay } from "./ErrorOverlay";
import type { ColorScheme } from "@/hooks/useColorScheme";

export type FactAction = {
  type: "save";
  factId: string;
  factText: string;
};

type ChatKitPanelProps = {
  theme: ColorScheme;
  onWidgetAction: (action: FactAction) => Promise<void>;
  onResponseEnd: () => void;
  onThemeRequest: (scheme: ColorScheme) => void;
};

type ErrorState = {
  script: string | null;
  session: string | null;
  integration: string | null;
  retryable: boolean;
};

const isBrowser = typeof window !== "undefined";
const isDev = process.env.NODE_ENV !== "production";

const createInitialErrors = (): ErrorState => ({
  script: null,
  session: null,
  integration: null,
  retryable: false,
});

export function ChatKitPanel({
  theme,
  onWidgetAction,
  onResponseEnd,
  onThemeRequest,
}: ChatKitPanelProps) {
  const processedFacts = useRef(new Set<string>());
  const [errors, setErrors] = useState<ErrorState>(() => createInitialErrors());
  const [isInitializingSession, setIsInitializingSession] = useState(true);
  const isMountedRef = useRef(true);
  const [scriptStatus, setScriptStatus] = useState<"pending" | "ready" | "error">(
    () => (isBrowser && window.customElements?.get("openai-chatkit") ? "ready" : "pending")
  );
  const [widgetInstanceKey, setWidgetInstanceKey] = useState(0);
  const kitRef = useRef<any>(null);

  const setErrorState = useCallback((updates: Partial<ErrorState>) => {
    setErrors((current) => ({ ...current, ...updates }));
  }, []);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!isBrowser) return;

    let timeoutId: number | undefined;

    const handleLoaded = () => {
      if (!isMountedRef.current) return;
      setScriptStatus("ready");
      setErrorState({ script: null });
    };

    const handleError = (event: Event) => {
      if (!isMountedRef.current) return;
      setScriptStatus("error");
      const detail = (event as CustomEvent<unknown>)?.detail ?? "unknown error";
      setErrorState({ script: `Error: ${detail}`, retryable: false });
      setIsInitializingSession(false);
    };

    window.addEventListener("chatkit-script-loaded", handleLoaded);
    window.addEventListener("chatkit-script-error", handleError as EventListener);

    if (window.customElements?.get("openai-chatkit")) {
      handleLoaded();
    } else if (scriptStatus === "pending") {
      timeoutId = window.setTimeout(() => {
        if (!window.customElements?.get("openai-chatkit")) {
          handleError(
            new CustomEvent("chatkit-script-error", {
              detail: "ChatKit web component is unavailable. Verify that the script URL is reachable.",
            })
          );
        }
      }, 5000);
    }

    return () => {
      window.removeEventListener("chatkit-script-loaded", handleLoaded);
      window.removeEventListener("chatkit-script-error", handleError as EventListener);
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [scriptStatus, setErrorState]);

  const isWorkflowConfigured = Boolean(WORKFLOW_ID && !WORKFLOW_ID.startsWith("wf_replace"));

  useEffect(() => {
    if (!isWorkflowConfigured && isMountedRef.current) {
      setErrorState({
        session: "Set NEXT_PUBLIC_CHATKIT_WORKFLOW_ID in your .env.local file.",
        retryable: false,
      });
      setIsInitializingSession(false);
    }
  }, [isWorkflowConfigured, setErrorState]);

  const handleResetChat = useCallback(() => {
    processedFacts.current.clear();
    if (isBrowser) {
      setScriptStatus(window.customElements?.get("openai-chatkit") ? "ready" : "pending");
    }
    setIsInitializingSession(true);
    setErrors(createInitialErrors());
    setWidgetInstanceKey((prev) => prev + 1);
  }, []);

  const getClientSecret = useCallback(
    async (currentSecret: string | null) => {
      if (!isWorkflowConfigured) {
        const detail = "Set NEXT_PUBLIC_CHATKIT_WORKFLOW_ID in your .env.local file.";
        if (isMountedRef.current) {
          setErrorState({ session: detail, retryable: false });
          setIsInitializingSession(false);
        }
        throw new Error(detail);
      }

      if (isMountedRef.current) {
        if (!currentSecret) setIsInitializingSession(true);
        setErrorState({ session: null, integration: null, retryable: false });
      }

      try {
        const response = await fetch(CREATE_SESSION_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workflow: { id: WORKFLOW_ID },
            chatkit_configuration: { file_upload: { enabled: true } },
          }),
        });

        const raw = await response.text();
        let data: Record<string, unknown> = {};
        if (raw) {
          try {
            data = JSON.parse(raw) as Record<string, unknown>;
          } catch {}
        }

        if (!response.ok) {
          const detail = extractErrorDetail(data, response.statusText);
          throw new Error(detail);
        }

        const clientSecret = (data as any)?.client_secret as string | undefined;
        if (!clientSecret) throw new Error("Missing client secret in response");

        if (isMountedRef.current) setErrorState({ session: null, integration: null });

        return clientSecret;
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Unable to start ChatKit session.";
        if (isMountedRef.current) setErrorState({ session: detail, retryable: false });
        throw error instanceof Error ? error : new Error(detail);
      } finally {
        if (isMountedRef.current && !currentSecret) setIsInitializingSession(false);
      }
    },
    [isWorkflowConfigured, setErrorState]
  );

  const chatkit = useChatKit({
    api: { getClientSecret },
    theme: { colorScheme: theme, ...getThemeConfig(theme) },
    startScreen: { greeting: GREETING, prompts: STARTER_PROMPTS },
    composer: { placeholder: PLACEHOLDER_INPUT, attachments: { enabled: true } },
    threadItemActions: { feedback: false },
    widgets: {
      onAction: async (action, widgetItem) => {
        const type = typeof action === "string" ? action : String(action?.type ?? "");
        const payload = (typeof action === "string" ? {} : (action?.payload ?? {})) as Record<string, any>;
        const form = (widgetItem as any)?.form ?? payload?.form ?? {};
        const quizId = payload?.quizId ?? (widgetItem as any)?.quizId ?? null;
        const answer = payload?.answer ?? form?.answer ?? null;

        if (type === "question.submit") {
          const el = kitRef.current as any;
          console.log("quiz.submit", { quizId, answer, payload });
          try {
            const res = await fetch("/api/quiz/submit", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ quizId, answer }),
            });
            if (!res.ok) throw new Error(`API ${res.status}`);
            if (el?.sendUserMessage) {
              await el.sendUserMessage({
                text: `Recorded your answer "${answer}" for quiz "${quizId}".`,
                reply: (widgetItem as any)?.id,
              });
            }
          } catch {
            if (el?.sendUserMessage) {
              await el.sendUserMessage({
                text: "Sorry — couldn’t save your answer right now.",
                reply: (widgetItem as any)?.id,
              });
            }
          }
          return { ok: true, quizId, answer };
        }

        if (type === "skin.survey.submit") {
          const pick = (k: string) => (payload && k in payload ? payload[k] : null);
          let allergies = Object.entries(payload)
            .filter(([k, v]) => k.startsWith("q4_") && v)
            .map(([k]) => k.replace(/^q4_/, ""));
          if (allergies.includes("none")) allergies = ["none"];
          const survey = {
            q1: pick("q1"),
            q2: pick("q2"),
            q3: pick("q3"),
            q4: allergies,
            q5: pick("q5"),
            q6: pick("q6"),
            q7: pick("q7"),
            q8: pick("q8"),
          };
          const el = kitRef.current as any;
          console.log("skin.survey.submit.payload", payload);
          console.log("skin.survey.submit.normalized", survey);
          const pretty = (v: any) =>
            typeof v === "string" ? v.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : String(v);
          const list = (arr: any[]) => (!arr || arr.length === 0 ? "None" : arr.map(pretty).join(", "));
          const summary =
            "Survey saved:\n" +
            `- Skin type: ${pretty(survey.q1)}\n` +
            `- Primary concern: ${pretty(survey.q2)}\n` +
            `- Allergies: ${list(survey.q4)}\n` +
            `- Product preference: ${pretty(survey.q5)}\n` +
            `- Routine: ${pretty(survey.q6)}\n` +
            `- Sensitivity: ${pretty(survey.q7)}\n` +
            `- Desired results: ${pretty(survey.q8)}`;
          try {
            const res = await fetch("/api/survey/submit", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(survey),
            });
            if (!res.ok) throw new Error(`API ${res.status}`);
            if (el?.sendUserMessage) {
              await el.sendUserMessage({
                text: summary,
                reply: (widgetItem as any)?.id,
              });
            }
          } catch {
            if (el?.sendUserMessage) {
              await el.sendUserMessage({
                text: "Sorry — couldn’t save your survey right now.",
                reply: (widgetItem as any)?.id,
              });
            }
          }
          return { ok: true };
        }

        return { ok: true };
      },
    },
    onClientTool: async (invocation: { name: string; params: Record<string, unknown> }) => {
      if (invocation.name === "switch_theme") {
        const requested = (invocation.params as any).theme;
        if (requested === "light" || requested === "dark") {
          onThemeRequest(requested);
          return { success: true };
        }
        return { success: false };
      }
      if (invocation.name === "record_fact") {
        const id = String((invocation.params as any).fact_id ?? "");
        const text = String((invocation.params as any).fact_text ?? "");
        if (!id || processedFacts.current.has(id)) return { success: true };
        processedFacts.current.add(id);
        void onWidgetAction({
          type: "save",
          factId: id,
          factText: text.replace(/\s+/g, " ").trim(),
        });
        return { success: true };
      }
      return { success: false };
    },
    onResponseEnd: () => {
      onResponseEnd();
    },
    onResponseStart: () => {
      setErrorState({ integration: null, retryable: false });
    },
    onThreadChange: () => {
      processedFacts.current.clear();
    },
    onError: ({ error }: { error: unknown }) => {
      console.error("ChatKit error", error);
    },
    onLog: ({ name, data }) => {
      console.debug("[chatkit]", name, data);
    },
  });

  useEffect(() => {
    const el = kitRef.current;
    if (!el || !el.addEventListener) return;
    const onErr = (e: any) => console.error("ck.error", e.detail?.error);
    const onLog = (e: any) => console.debug("[chatkit.event]", e.detail?.name, e.detail?.data);
    el.addEventListener("chatkit.error", onErr);
    el.addEventListener("chatkit.log", onLog);
    return () => {
      el.removeEventListener("chatkit.error", onErr);
      el.removeEventListener("chatkit.log", onLog);
    };
  }, [kitRef, widgetInstanceKey]);

  const activeError = errors.session ?? errors.integration;
  const blockingError = errors.script ?? activeError;

  if (isDev) {
    console.debug("[ChatKitPanel] render state", {
      isInitializingSession,
      hasControl: Boolean(chatkit.control),
      scriptStatus,
      hasError: Boolean(blockingError),
      workflowId: WORKFLOW_ID,
    });
  }

  return (
    <div className="relative pb-8 flex h-[90vh] w-full rounded-2xl flex-col overflow-hidden bg-white shadow-sm transition-colors dark:bg-slate-900">
      <ChatKit
        ref={kitRef}
        key={widgetInstanceKey}
        control={chatkit.control}
        className={
          blockingError || isInitializingSession ? "pointer-events-none opacity-0" : "block h-full w-full"
        }
      />
      <ErrorOverlay
        error={blockingError}
        fallbackMessage={
          blockingError || !isInitializingSession ? null : "Loading assistant session..."
        }
        onRetry={blockingError && errors.retryable ? handleResetChat : null}
        retryLabel="Restart chat"
      />
    </div>
  );
}

function extractErrorDetail(
  payload: Record<string, unknown> | undefined,
  fallback: string
): string {
  if (!payload) return fallback;
  const error = (payload as any).error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error && typeof (error as any).message === "string") {
    return (error as any).message;
  }
  const details = (payload as any).details;
  if (typeof details === "string") return details;
  if (details && typeof details === "object" && "error" in details) {
    const nestedError = (details as any).error;
    if (typeof nestedError === "string") return nestedError;
    if (nestedError && typeof nestedError === "object" && "message" in nestedError && typeof (nestedError as any).message === "string") {
      return (nestedError as any).message;
    }
  }
  if (typeof (payload as any).message === "string") return (payload as any).message;
  return fallback;
}
