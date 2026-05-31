import type { AssistantLLMResponsePayload } from "./aiContracts.js";
import type {
  AssistantHealthComputedPayload,
  AssistantProfileAppliedPayload,
  AssistantScheduleSuggestionPayload
} from "./torrentCore/contracts.js";

export const ASSISTANT_EVENT_CHANNEL = "assistant:event";

export const ASSISTANT_EVENT_NAMES = [
  "assistant.health.computed",
  "assistant.llm.response",
  "assistant.schedule.suggestion",
  "assistant.profile.applied"
] as const;

export interface AssistantEventPayloadMap {
  "assistant.health.computed": AssistantHealthComputedPayload;
  "assistant.llm.response": AssistantLLMResponsePayload;
  "assistant.schedule.suggestion": AssistantScheduleSuggestionPayload;
  "assistant.profile.applied": AssistantProfileAppliedPayload;
}

export type AssistantEvent = {
  [EventName in keyof AssistantEventPayloadMap]: {
    type: EventName;
    payload: AssistantEventPayloadMap[EventName];
  };
}[keyof AssistantEventPayloadMap];

export function isAssistantEvent(event: {
  type: string;
  payload: unknown;
}): event is AssistantEvent {
  return ASSISTANT_EVENT_NAMES.includes(
    event.type as (typeof ASSISTANT_EVENT_NAMES)[number]
  );
}
