import type {
  ChatMessage,
  ChatMessageAssistant,
  ChatMessageSystem,
  ChatMessageTool,
  ChatMessageUser,
  Event,
} from "@tsmono/inspect-common/types";

export const messagesFromEvents = (runningEvents: Event[]): ChatMessage[] => {
  const messages: Map<
    string,
    ChatMessageSystem | ChatMessageUser | ChatMessageAssistant | ChatMessageTool
  > = new Map();

  runningEvents
    .filter((e) => e.event === "model")
    .filter((e) => !e.error)
    .forEach((e) => {
      for (const m of e.input) {
        const inputMessage = m as
          | ChatMessageSystem
          | ChatMessageUser
          | ChatMessageAssistant
          | ChatMessageTool;
        if (inputMessage.id && !messages.has(inputMessage.id)) {
          messages.set(inputMessage.id, inputMessage);
        }
      }
      const outputMessage = e.output.choices[0].message;
      if (outputMessage.id) {
        messages.set(outputMessage.id, outputMessage);
      }
    });

  if (messages.size > 0) {
    return messages.values().toArray();
  } else {
    return [];
  }
};
