import { z } from "zod";

export const ConfirmField = z
  .boolean()
  .default(false)
  .describe(
    "Must be explicitly set to true to actually execute this action. " +
      "When false (default), the tool returns a preview of what would happen without making any changes."
  );

export function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

export function jsonResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

export function errorResult(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

export function confirmPreview(action: string, details: unknown) {
  return textResult(
    `PREVIEW (no changes made) — ${action}\n\n` +
      `${JSON.stringify(details, null, 2)}\n\n` +
      `Re-run this tool with confirm: true to execute.`
  );
}
