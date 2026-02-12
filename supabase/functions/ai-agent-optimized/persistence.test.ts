import { assertEquals } from "https://deno.land/std@0.224.0/testing/asserts.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.50.0";
import { persistChatMessage } from "./persistence.ts";

type InsertPayload = Record<string, unknown>;

class MockInsertBuilder {
  #table: string;
  #inserted: InsertPayload[];
  #conversationId: string;
  #lastPayload: InsertPayload | null = null;

  constructor(table: string, inserted: InsertPayload[], conversationId: string) {
    this.#table = table;
    this.#inserted = inserted;
    this.#conversationId = conversationId;
  }

  insert(payload: InsertPayload) {
    this.#lastPayload = payload;
    this.#inserted.push({ table: this.#table, ...payload });
    return this;
  }

  select(_columns: string) {
    return this;
  }

  async single() {
    if (this.#table === "conversations") {
      return { data: { id: this.#conversationId }, error: null };
    }
    return {
      data: { conversation_id: (this.#lastPayload?.conversation_id as string) ?? this.#conversationId },
      error: null,
    };
  }
}

function createMockDb(inserted: InsertPayload[], conversationId = "conv-1"): SupabaseClient {
  return {
    from: (table: string) =>
      new MockInsertBuilder(table, inserted, conversationId) as unknown as ReturnType<SupabaseClient["from"]>,
  } as unknown as SupabaseClient;
}

Deno.test("persistChatMessage writes user_id to conversations and chat_history", async () => {
  const inserted: InsertPayload[] = [];
  const db = createMockDb(inserted, "generated-conv");

  const conversationId = await persistChatMessage({
    db,
    userId: "user-123",
    role: "user",
    content: "hello",
    context: { source: "test" },
  });

  assertEquals(conversationId, "generated-conv");
  assertEquals(inserted.length, 2);
  assertEquals(inserted[0], {
    table: "conversations",
    user_id: "user-123",
    title: "New Conversation",
  });
  assertEquals(inserted[1], {
    table: "chat_history",
    user_id: "user-123",
    role: "user",
    content: "hello",
    context: { source: "test" },
    action_type: undefined,
    action_data: undefined,
    conversation_id: "generated-conv",
  });
});

Deno.test("persistChatMessage reuses supplied conversation and still writes user_id", async () => {
  const inserted: InsertPayload[] = [];
  const db = createMockDb(inserted, "ignored");

  const conversationId = await persistChatMessage({
    db,
    userId: "user-999",
    role: "assistant",
    content: "response",
    conversationId: "existing-conv",
    action: { type: "schedule_session", data: { session_id: "s-1" } },
  });

  assertEquals(conversationId, "existing-conv");
  assertEquals(inserted.length, 1);
  assertEquals(inserted[0], {
    table: "chat_history",
    user_id: "user-999",
    role: "assistant",
    content: "response",
    context: {},
    action_type: "schedule_session",
    action_data: { session_id: "s-1" },
    conversation_id: "existing-conv",
  });
});
