import type { SupabaseClient } from "npm:@supabase/supabase-js@2.50.0";

export interface PersistChatMessageParams {
  db: SupabaseClient;
  userId: string;
  role: "user" | "assistant" | "system";
  content: string;
  context?: Record<string, unknown>;
  action?: { type: string; data: Record<string, unknown> };
  conversationId?: string;
}

export async function persistChatMessage(params: PersistChatMessageParams): Promise<string> {
  const {
    db,
    userId,
    role,
    content,
    context = {},
    action,
    conversationId,
  } = params;

  let actualConversationId = conversationId;
  if (!actualConversationId) {
    const { data: convData, error: convError } = await db
      .from("conversations")
      .insert({ user_id: userId, title: "New Conversation" })
      .select("id")
      .single();

    if (convError) {
      throw convError;
    }

    actualConversationId = (convData as { id: string }).id;
  }

  const { data: msgData, error: msgError } = await db
    .from("chat_history")
    .insert({
      user_id: userId,
      role,
      content,
      context,
      action_type: action?.type,
      action_data: action?.data,
      conversation_id: actualConversationId,
    })
    .select("conversation_id")
    .single();

  if (msgError) {
    throw msgError;
  }

  return (msgData as { conversation_id: string }).conversation_id;
}
