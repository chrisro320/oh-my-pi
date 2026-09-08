// @omp-managed-extension
/**
 * Magic Commands Extension
 *
 * Exposes /workflowz, /orchestrate, and /ultrathink as clean slash commands:
 * - With arguments (e.g. `/workflowz audit code`): dispatches the user message
 *   with the corresponding magic keyword prefixed, cleanly triggering omp native
 *   hidden system notice (display: false) without polluting the chat bubble.
 * - Without arguments (e.g. `/workflowz`): pre-fills the input editor with the magic keyword
 *   and trailing space, triggering the live editor gradient glow so the user can continue typing.
 */

interface CommandContext {
  ui: {
    setEditorText(text: string): void;
  };
}

interface ExtensionAPI {
  registerCommand(
    name: string,
    options: {
      description: string;
      handler: (args: string, ctx: CommandContext) => Promise<void> | void;
    },
  ): void;
  sendUserMessage(content: string): void;
}

export default function (pi: ExtensionAPI) {
  const commands = [
    {
      name: "ultrathink",
      keyword: "ultrathink",
      description: "觸發深度多步推理 (Multi-step reasoning)",
    },
    {
      name: "orchestrate",
      keyword: "orchestrate",
      description: "觸發多子任務並行編排 (Task orchestration)",
    },
    {
      name: "workflowz",
      keyword: "workflowz",
      description: "觸發確定性多子代理工作流 (Deterministic workpool workflow)",
    },
  ];

  for (const { name, keyword, description } of commands) {
    pi.registerCommand(name, {
      description,
      handler: async (args: string, ctx: CommandContext) => {
        const trimmed = (args || "").trim();
        if (trimmed) {
          pi.sendUserMessage(`${keyword} ${trimmed}`);
        } else {
          try {
            ctx.ui.setEditorText(`${keyword} `);
          } catch {}
        }
      },
    });
  }
}
