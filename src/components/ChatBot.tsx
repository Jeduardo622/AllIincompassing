import React, { useState, useRef, useEffect } from "react";
import {
  MessageSquare,
  Send,
  AlertCircle,
  Loader,
  CheckCircle,
  XCircle,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { processMessage } from "../lib/ai";
import { supabase } from "../lib/supabase";
import { cancelSessions } from "../lib/sessionCancellation";
import { showSuccess, showError } from "../lib/toast";
import { errorTracker } from "../lib/errorTracking";
import { logger } from "../lib/logger/logger";
import { useAuth } from "../lib/authContext";
// import type { Session, Client, Therapist, Authorization, AuthorizationService } from "../types";

interface Message {
  role: "user" | "assistant";
  content: string;
  status?:
    | "sending"
    | "processing"
    | "complete"
    | "error"
    | "action_success"
    | "action_failed";
}

export default function ChatBot() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { session } = useAuth();

  // Load conversation ID from localStorage on component mount
  useEffect(() => {
    const savedConversationId = localStorage.getItem("chatConversationId");
    if (savedConversationId) {
      setConversationId(savedConversationId);
      logger.debug('Loaded chat conversation identifier from storage');
    }
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput("");
    setError(null);

    // Add user message
    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        content: userMessage,
        status: "complete",
      },
    ]);

    try {
      if (!session?.access_token) {
        const authError = new Error('Active session is required to call edge functions');
        errorTracker.trackAIError(authError, {
          functionCalled: "ChatBot_processMessage",
          errorType: "auth_error",
        });
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: "Please sign in to use the assistant.",
            status: "error",
          },
        ]);
        setError("Authentication required");
        showError("Please sign in to use the assistant.");
        return;
      }

      // Add placeholder for assistant response
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Thinking...",
          status: "sending",
        },
      ]);

      setIsLoading(true);

      // Process the message
      const response = await processMessage(
        userMessage,
        {
          url: window.location.href,
          userAgent: navigator.userAgent,
          conversationId: conversationId || undefined,
        },
        { accessToken: session.access_token }
      );

      // Store the conversation ID for future messages
      if (response.conversationId) {
        localStorage.setItem("chatConversationId", response.conversationId);
        setConversationId(response.conversationId);
        logger.debug('Persisted chat conversation identifier after assistant response');
      }

      // Update assistant message with initial response
      setMessages((prev) => [
        ...prev.slice(0, -1),
        {
          role: "assistant",
          content: response.response,
          status: response.action ? "processing" : "complete",
        },
      ]);

      // Handle actions returned by the AI
      if (response.action) {
        logger.info('Executing chat bot action', {
          metadata: { actionType: response.action.type }
        });

        const actionType = response.action.type;

        try {
          switch (response.action.type) {
            case "cancel_sessions": {
              const { date, reason, therapist_id: therapistId } =
                response.action.data;
              if (!date) {
                throw new Error("Cancellation requests must include a date");
              }

              const cancellationReason =
                typeof reason === "string" && reason.trim().length > 0
                  ? reason
                  : "Staff development day";

              setMessages((prev) => [
                ...prev.slice(0, -1),
                {
                  role: "assistant",
                  content: `${response.response}\n\n⏳ Cancelling sessions...`,
                  status: "processing",
                },
              ]);

              try {
                const result = await cancelSessions({
                  date,
                  therapistId,
                  reason: cancellationReason,
                });

                await queryClient.invalidateQueries({
                  queryKey: ["sessions"],
                });

                const successParts: string[] = [];
                if (result.cancelledCount > 0) {
                  successParts.push(
                    `${result.cancelledCount} session${
                      result.cancelledCount === 1 ? "" : "s"
                    } cancelled`,
                  );
                }
                if (result.alreadyCancelledCount > 0) {
                  successParts.push(
                    `${result.alreadyCancelledCount} already cancelled`,
                  );
                }
                if (result.totalCount === 0) {
                  successParts.push("no sessions found");
                }

                const summaryMessage =
                  successParts.length > 0
                    ? successParts.join(", ")
                    : "No matching sessions to cancel";

                showSuccess(summaryMessage);

                const formattedDate = new Date(`${date}T00:00:00`).toLocaleDateString();
                const assistantMessage = [
                  response.response,
                  "",
                  result.totalCount === 0
                    ? "ℹ️ No sessions matched the request."
                    : `✅ ${result.cancelledCount} session${
                        result.cancelledCount === 1 ? "" : "s"
                      } cancelled for ${formattedDate}.`,
                  result.alreadyCancelledCount > 0
                    ? `ℹ️ ${result.alreadyCancelledCount} session${
                        result.alreadyCancelledCount === 1 ? "" : "s"
                      } were already cancelled.`
                    : null,
                  cancellationReason
                    ? `Reason noted: ${cancellationReason}`
                    : null,
                ]
                  .filter((line): line is string => Boolean(line))
                  .join("\n\n");

                setMessages((prev) => [
                  ...prev.slice(0, -1),
                  {
                    role: "assistant",
                    content: assistantMessage,
                    status: "action_success",
                  },
                ]);
              } catch (dbError) {
                logger.error('Session cancellation workflow failed', {
                  error: dbError,
                  context: { component: 'ChatBot', operation: 'cancel_sessions' }
                });
                throw dbError;
              }

              break;
            }

            case "schedule_session": {
              const detail = response.action.data;
              localStorage.setItem("pendingSchedule", JSON.stringify(detail));
              document.dispatchEvent(
                new CustomEvent("openScheduleModal", {
                  detail,
                }),
              );
              navigate("/schedule");
              break;
            }

            case "modify_session": {
              const { session_id, ...updates } = response.action.data;

              setMessages((prev) => [
                ...prev.slice(0, -1),
                {
                  role: "assistant",
                  content: response.response + "\n\n⏳ Updating session...",
                  status: "processing",
                },
              ]);

              const { error } = await supabase
                .from("sessions")
                .update(updates)
                .eq("id", session_id);

              if (error) throw error;

              await queryClient.invalidateQueries({ queryKey: ["sessions"] });
              showSuccess("Session updated successfully");

              setMessages((prev) => [
                ...prev.slice(0, -1),
                {
                  role: "assistant",
                  content:
                    response.response + "\n\n✅ Session has been updated.",
                  status: "complete",
                },
              ]);
              break;
            }

            case "create_client": {
              setMessages((prev) => [
                ...prev.slice(0, -1),
                {
                  role: "assistant",
                  content:
                    response.response + "\n\n⏳ Creating client profile...",
                  status: "processing",
                },
              ]);

              const { error } = await supabase
                .from("clients")
                .insert([response.action.data])
                .select()
                .single();

              if (error) throw error;

              await queryClient.invalidateQueries({ queryKey: ["clients"] });
              showSuccess("Client created successfully");

              setMessages((prev) => [
                ...prev.slice(0, -1),
                {
                  role: "assistant",
                  content:
                    response.response +
                    "\n\n✅ Client profile has been created.",
                  status: "complete",
                },
              ]);
              break;
            }

            case "update_client": {
              const { client_id, ...updates } = response.action.data;

              setMessages((prev) => [
                ...prev.slice(0, -1),
                {
                  role: "assistant",
                  content:
                    response.response + "\n\n⏳ Updating client profile...",
                  status: "processing",
                },
              ]);

              const { error } = await supabase
                .from("clients")
                .update(updates)
                .eq("id", client_id);

              if (error) throw error;

              await queryClient.invalidateQueries({ queryKey: ["clients"] });
              showSuccess("Client updated successfully");

              setMessages((prev) => [
                ...prev.slice(0, -1),
                {
                  role: "assistant",
                  content:
                    response.response +
                    "\n\n✅ Client profile has been updated.",
                  status: "complete",
                },
              ]);
              break;
            }

            case "create_therapist": {
              setMessages((prev) => [
                ...prev.slice(0, -1),
                {
                  role: "assistant",
                  content:
                    response.response + "\n\n⏳ Creating therapist profile...",
                  status: "processing",
                },
              ]);

              const { error } = await supabase
                .from("therapists")
                .insert([response.action.data])
                .select()
                .single();

              if (error) throw error;

              await queryClient.invalidateQueries({ queryKey: ["therapists"] });
              showSuccess("Therapist created successfully");

              setMessages((prev) => [
                ...prev.slice(0, -1),
                {
                  role: "assistant",
                  content:
                    response.response +
                    "\n\n✅ Therapist profile has been created.",
                  status: "complete",
                },
              ]);
              break;
            }

            case "update_therapist": {
              const { therapist_id, ...updates } = response.action.data;

              setMessages((prev) => [
                ...prev.slice(0, -1),
                {
                  role: "assistant",
                  content:
                    response.response + "\n\n⏳ Updating therapist profile...",
                  status: "processing",
                },
              ]);

              const { error } = await supabase
                .from("therapists")
                .update(updates)
                .eq("id", therapist_id);

              if (error) throw error;

              await queryClient.invalidateQueries({ queryKey: ["therapists"] });
              showSuccess("Therapist updated successfully");

              setMessages((prev) => [
                ...prev.slice(0, -1),
                {
                  role: "assistant",
                  content:
                    response.response +
                    "\n\n✅ Therapist profile has been updated.",
                  status: "complete",
                },
              ]);
              break;
            }

            case "create_authorization": {
              setMessages((prev) => [
                ...prev.slice(0, -1),
                {
                  role: "assistant",
                  content:
                    response.response + "\n\n⏳ Creating authorization...",
                  status: "processing",
                },
              ]);

              const { services, ...authData } = response.action.data;

              // First create the authorization
              const { data: auth, error: authError } = await supabase
                .from("authorizations")
                .insert([authData])
                .select()
                .single();

              if (authError) throw authError;

              // Then create all services
              if (services && services.length > 0) {
                const { error: servicesError } = await supabase
                  .from("authorization_services")
                  .insert(
                    services.map((service) => ({
                      ...service,
                      authorization_id: auth.id,
                    })),
                  );

                if (servicesError) throw servicesError;
              }

              await queryClient.invalidateQueries({
                queryKey: ["authorizations"],
              });
              showSuccess("Authorization created successfully");

              setMessages((prev) => [
                ...prev.slice(0, -1),
                {
                  role: "assistant",
                  content:
                    response.response +
                    "\n\n✅ Authorization has been created.",
                  status: "complete",
                },
              ]);
              break;
            }

            case "update_authorization": {
              const { authorization_id, services, ...updates } =
                response.action.data;

              setMessages((prev) => [
                ...prev.slice(0, -1),
                {
                  role: "assistant",
                  content:
                    response.response + "\n\n⏳ Updating authorization...",
                  status: "processing",
                },
              ]);

              // Update authorization status
              const { error: authError } = await supabase
                .from("authorizations")
                .update(updates)
                .eq("id", authorization_id);

              if (authError) throw authError;

              // Update services if provided
              if (services && services.length > 0) {
                for (const service of services) {
                  const { service_id, ...serviceUpdates } = service;
                  const { error: serviceError } = await supabase
                    .from("authorization_services")
                    .update(serviceUpdates)
                    .eq("id", service_id);

                  if (serviceError) throw serviceError;
                }
              }

              await queryClient.invalidateQueries({
                queryKey: ["authorizations"],
              });
              showSuccess("Authorization updated successfully");

              setMessages((prev) => [
                ...prev.slice(0, -1),
                {
                  role: "assistant",
                  content:
                    response.response +
                    "\n\n✅ Authorization has been updated.",
                  status: "complete",
                },
              ]);
              break;
            }

            case "initiate_client_onboarding": {
              const {
                client_name,
                client_email,
                date_of_birth,
                insurance_provider,
                referral_source,
                service_preference,
              } = response.action.data;

              // Update message to show processing
              setMessages((prev) => [
                ...prev.slice(0, -1),
                {
                  role: "assistant",
                  content:
                    response.response +
                    "\n\n⏳ Initiating client onboarding...",
                  status: "processing",
                },
              ]);

              // Redirect to client onboarding page with pre-filled data
              const queryParams = new URLSearchParams();
              if (client_name) {
                const nameParts = client_name.split(" ");
                if (nameParts.length > 0)
                  queryParams.append("first_name", nameParts[0]);
                if (nameParts.length > 1)
                  queryParams.append("last_name", nameParts.slice(1).join(" "));
              }
              if (client_email) queryParams.append("email", client_email);
              if (date_of_birth)
                queryParams.append("date_of_birth", date_of_birth);
              if (insurance_provider)
                queryParams.append("insurance_provider", insurance_provider);
              if (referral_source)
                queryParams.append("referral_source", referral_source);
              if (service_preference && Array.isArray(service_preference)) {
                queryParams.append(
                  "service_preference",
                  service_preference.join(","),
                );
              }

              // Construct the URL
              const onboardingUrl = `/clients/new?${queryParams.toString()}`;

              // Update message to show completion
              setMessages((prev) => [
                ...prev.slice(0, -1),
                {
                  role: "assistant",
                  content:
                    response.response +
                    "\n\n✅ Client onboarding initiated. You can complete the process by clicking the link below.",
                  status: "complete",
                },
              ]);

              // Open the onboarding page in a new tab
              window.open(onboardingUrl, "_blank");
              break;
            }
          }
        } catch (actionError) {
          logger.error('Chat bot action execution failed', {
            error: actionError,
            context: { component: 'ChatBot', operation: actionType }
          });
          showError(actionError);
          if (actionError instanceof Error) {
            errorTracker.trackAIError(actionError, {
              functionCalled: `ChatBot_${response.action?.type}`,
              errorType: "function_error",
            });
          }

          // Update message to show error
          setMessages((prev) => [
            ...prev.slice(0, -1),
            {
              role: "assistant",
              content:
                response.response +
                "\n\n❌ Error: " +
                (actionError instanceof Error
                  ? actionError.message
                  : "Unable to complete the requested action. Please try again or use the manual interface."),
              status: "action_failed",
            },
          ]);
        }
      }
    } catch (error) {
      logger.error('Chat bot message processing failed', {
        error,
        context: { component: 'ChatBot', operation: 'handleSubmit' }
      });

      const errorMessage =
        error instanceof Error ? error.message : "An error occurred";
      showError(errorMessage);
      if (error instanceof Error) {
        errorTracker.trackAIError(error, {
          functionCalled: "ChatBot_processMessage",
          errorType: "invalid_response",
        });
      }

      setMessages((prev) => [
        ...prev.slice(0, -1),
        {
          role: "assistant",
          content:
            "I apologize, but I encountered an error while processing your request. " +
            "Please try again or use the manual interface instead.",
          status: "error",
        },
      ]);

      setError("Unable to process your request. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <button
        id="chat-trigger"
        onClick={() => setIsOpen(true)}
        className="hidden"
      />

      {isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-dark-lighter rounded-t-lg sm:rounded-lg shadow-xl w-full max-w-lg flex flex-col h-[80vh] sm:h-[600px]">
            <div className="flex items-center justify-between p-4 border-b dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center">
                <MessageSquare className="w-5 h-5 mr-2 text-blue-600" />
                AI Assistant
              </h3>
              <button
                onClick={() => setIsOpen(false)}
                className="text-gray-400 hover:text-gray-500 dark:text-gray-500 dark:hover:text-gray-400"
              >
                <span className="sr-only">Close</span>
                <svg
                  className="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.length === 0 && (
                <div className="text-center text-gray-500 dark:text-gray-400 py-8">
                  <MessageSquare
                    className="h-8 w-8 mx-auto mb-3 opacity-50"
                    data-testid="empty-state-icon"
                  />
                  <p>
                    Hi! I'm your scheduling assistant. How can I help you today?
                  </p>
                  <p className="text-sm mt-2">You can ask me about:</p>
                  <ul className="text-sm mt-1 space-y-1">
                    <li>• Scheduling new sessions</li>
                    <li>• Canceling or modifying sessions</li>
                    <li>• Managing clients and therapists</li>
                    <li>• Handling authorizations</li>
                    <li>• Onboarding new clients</li>
                  </ul>
                </div>
              )}
              {messages.map((message, index) => (
                <div
                  key={index}
                  className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`rounded-lg px-4 py-2 max-w-[80%] relative ${
                      message.role === "user"
                        ? "bg-blue-600 text-white"
                        : "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                    }`}
                  >
                    <div className="whitespace-pre-wrap">{message.content}</div>
                    {message.status === "sending" && (
                      <div className="absolute -right-6 top-1/2 -translate-y-1/2">
                        <Loader className="w-4 h-4 animate-spin text-blue-600" />
                      </div>
                    )}
                    {message.status === "processing" && (
                      <div className="absolute -right-6 top-1/2 -translate-y-1/2">
                        <Loader className="w-4 h-4 animate-spin text-yellow-600" />
                      </div>
                    )}
                    {message.status === "action_success" && (
                      <div className="absolute -right-6 top-1/2 -translate-y-1/2">
                        <CheckCircle className="w-4 h-4 text-green-600" />
                      </div>
                    )}
                    {message.status === "action_failed" && (
                      <div className="absolute -right-6 top-1/2 -translate-y-1/2">
                        <XCircle className="w-4 h-4 text-red-600" />
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {error && (
                <div className="flex items-center justify-center text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-2 rounded-lg">
                  <AlertCircle className="w-4 h-4 mr-2" />
                  {error}
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <form
              onSubmit={handleSubmit}
              className="p-4 border-t dark:border-gray-700"
            >
              <div className="flex space-x-4">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Type your message..."
                  className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-dark shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:text-gray-200"
                  disabled={isLoading}
                  data-testid="ai-chat-input"
                />
                <button
                  type="submit"
                  disabled={isLoading || !input.trim()}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  data-testid="send-message"
                >
                  <Send className="h-5 w-5" />
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
