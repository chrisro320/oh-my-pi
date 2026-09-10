// @omp-managed-extension
/**
 * Auto Continue & In-Place Glitch Recovery Extension
 *
 * 核心原則：
 * 1. 堅決不換 IP、不換 Key、不換模型（保護單一固定節點免受風控）。
 * 2. 針對 Token 截斷 (stopReason === "length")：原地隱式續寫，不重複前文。
 * 3. 針對本機代理瞬態抖動 (TCP Reset / 502 / Premature Close 等)：原地休眠 3 秒等待代理重連，隨後原地重發。
 * 4. 提供 /unfreeze 命令一鍵解除計數與鎖定，防止假性 401 誤殺。
 * 5. 全生命週期經由 OMP 原生 `session_stop` 派發隱式上下文 (display: false)。
 */

interface SessionStopEvent {
  type: "session_stop";
  messages: Array<{
    role: string;
    content: unknown;
    stopReason?: string;
    errorMessage?: string;
  }>;
  last_assistant_message?: {
    role: string;
    content: unknown;
    stopReason?: string;
    errorMessage?: string;
  };
  stop_hook_active: boolean;
  signal: AbortSignal;
}

interface SessionStopResult {
  continue?: boolean;
  additionalContext?: string;
}

interface ExtensionUIContext {
  notify(message: string, type?: "info" | "warning" | "error"): void;
}

interface ExtensionContext {
  ui: ExtensionUIContext;
}

interface ExtensionAPI {
  on(
    event: "session_stop",
    handler: (
      event: SessionStopEvent,
      ctx: ExtensionContext,
    ) => Promise<SessionStopResult | void> | SessionStopResult | void,
  ): void;
  on(event: "input", handler: () => void): void;
  registerCommand(
    name: string,
    options: {
      description: string;
      handler: (args: string, ctx: ExtensionContext) => Promise<void> | void;
    },
  ): void;
}

const NETWORK_GLITCH_PATTERN =
  /\b(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|socket hang up|premature close|stream ended unexpectedly|fetch failed|network[-_\s]?error|connection[-_\s]?error|Bad Gateway|Gateway Timeout|Service Unavailable|(?:status|code|http)\s*[:=]?\s*50[234])\b/i;

function isNetworkGlitch(errorMessage?: string): boolean {
  if (!errorMessage || typeof errorMessage !== "string") return false;
  return NETWORK_GLITCH_PATTERN.test(errorMessage);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  if (signal?.aborted) {
    resolve();
    return promise;
  }
  let timer: Timer | number | undefined;
  const onAbort = () => {
    clearTimeout(timer);
    resolve();
  };
  timer = setTimeout(() => {
    if (typeof signal?.removeEventListener === "function") {
      signal.removeEventListener("abort", onAbort);
    }
    resolve();
  }, ms);
  if (typeof signal?.addEventListener === "function") {
    signal.addEventListener("abort", onAbort, { once: true });
  }
  return promise;
}

export default function (pi: ExtensionAPI) {
  let enabled = true;
  let maxContinues = 2;
  let currentContinueCount = 0;

  // 用戶手動發送新輸入時，重置連續重試計數器
  pi.on("input", () => {
    currentContinueCount = 0;
  });

  pi.on(
    "session_stop",
    async (
      event: SessionStopEvent,
      ctx: ExtensionContext,
    ): Promise<SessionStopResult | void> => {
      if (!enabled) return;

      // 若用戶主動打斷 (Esc/Abort)，終止並重置
      if (event.signal?.aborted) {
        currentContinueCount = 0;
        return;
      }

      const lastMessage =
        event.last_assistant_message ??
        (event.messages && event.messages.length > 0
          ? event.messages[event.messages.length - 1]
          : undefined);

      if (!lastMessage || lastMessage.role !== "assistant") return;

      const isLengthTruncated = lastMessage.stopReason === "length";
      const isGlitch =
        lastMessage.stopReason === "error" &&
        isNetworkGlitch(lastMessage.errorMessage);

      // 非受管截斷或抖動，重置計數
      if (!isLengthTruncated && !isGlitch) {
        currentContinueCount = 0;
        return;
      }

      // 達到設定的連續重試/續寫上限
      if (currentContinueCount >= maxContinues) {
        ctx.ui.notify(
          `自動續寫/重試已達上限 (${maxContinues} 次)，已暫停自動喚醒，等待人工確認。`,
          "warning",
        );
        currentContinueCount = 0;
        return;
      }

      currentContinueCount++;

      // 場景 A：Token 預算上限截斷
      if (isLengthTruncated) {
        ctx.ui.notify(
          `檢測到輸出因 Token 限制截斷，自動喚醒續寫 (${currentContinueCount}/${maxContinues})...`,
          "info",
        );
        return {
          continue: true,
          additionalContext:
            "上一次輸出因達到單次 Token 上限被截断。請緊接上一次輸出的末尾斷點處直接繼續輸出剩餘內容。嚴禁重複前面已經輸出過的任何文字或程式碼，直接接著寫。",
        };
      }

      // 場景 B：本地代理（如 mihomo）瞬態抖動 / TCP Reset
      if (isGlitch) {
        ctx.ui.notify(
          `檢測到代理連接瞬態抖動，原地等待 3 秒後重試同節點 (${currentContinueCount}/${maxContinues})...`,
          "info",
        );
        await sleep(3000, event.signal);
        if (event.signal?.aborted) {
          currentContinueCount = 0;
          return;
        }
        return {
          continue: true,
          additionalContext:
            "剛才本地代理連接發生瞬態丟包或中斷，當前固定節點已重連。請在當前模型下直接重新生成並繼續上一次的請求。",
        };
      }
    },
  );

  // 註冊控制命令
  pi.registerCommand("autocontinue", {
    description:
      "查看或切換自動續寫與防抖重試插件狀態 (/autocontinue [on|off|max <n>])",
    handler: async (args: string, ctx: ExtensionContext) => {
      const parts = (args || "").trim().split(/\s+/);
      const sub = parts[0]?.toLowerCase() || "";

      if (sub === "on") {
        enabled = true;
        currentContinueCount = 0;
        ctx.ui.notify("已開啟自動續寫與防抖重試", "info");
      } else if (sub === "off") {
        enabled = false;
        currentContinueCount = 0;
        ctx.ui.notify("已關閉自動續寫與防抖重試", "info");
      } else if (sub === "max") {
        const val = parseInt(parts[1], 10);
        if (Number.isFinite(val) && val > 0 && val <= 10) {
          maxContinues = val;
          ctx.ui.notify(
            `已將單輪最大重試/續寫次數設置為 ${maxContinues} 次`,
            "info",
          );
        } else {
          ctx.ui.notify(
            "請輸入 1 到 10 之間的有效正整數，例如: /autocontinue max 3",
            "warning",
          );
        }
      } else {
        ctx.ui.notify(
          `自動續寫/防抖: ${enabled ? "開啟" : "關閉"} | 最大連續次數: ${maxContinues} 次\n用法: /autocontinue [on|off|max <n>]`,
          "info",
        );
      }
    },
  });

  // 註冊一鍵解凍命令
  pi.registerCommand("unfreeze", {
    description: "清空重試鎖定並重置計數，原地恢復當前節點請求",
    handler: async (_args: string, ctx: ExtensionContext) => {
      currentContinueCount = 0;
      ctx.ui.notify(
        "已重置重試計數器與鎖定狀態。若使用 Command Code Key Pool，可配合執行 `/commandcode-pool use 1` 原地解除 Key 鎖定。",
        "info",
      );
    },
  });
}
