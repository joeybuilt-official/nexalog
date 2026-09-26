export const AiCommands = [
  "summarize",
  "related",
  "checklist",
  "expand",
  "shorten",
  "rephrase",
] as const;
export type AiCommand = (typeof AiCommands)[number];

const PROMPTS: Record<AiCommand, string> = {
  summarize: "Summarize the following text concisely:",
  related: "List related ideas or concepts for the following text:",
  checklist: "Convert the following text into a markdown checklist:",
  expand: "Expand the following text with more detail:",
  shorten: "Shorten the following text while preserving the key meaning:",
  rephrase: "Rephrase the following text:",
};

export function buildInlineAiPrompt(
  command: AiCommand,
  blockText: string,
  surroundingContext?: string,
): string {
  const prompt = PROMPTS[command];
  return surroundingContext
    ? `${prompt}\n\nContext: ${surroundingContext}\n\nText: ${blockText}`
    : `${prompt}\n\n${blockText}`;
}
