import { supabase } from './supabase';
import { errorTracker } from './errorTracking';
import type { Therapist, Client, Session } from '../types';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  context?: Record<string, any>;
}

interface ChatHistory {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  context: Record<string, any>;
  action_type?: string;
  action_data?: Record<string, any>;
  created_at: string;
}

interface AIResponse {
  response: string;
  action?: {
    type: 'schedule_session' | 'cancel_sessions' | 'modify_session' | 'create_client' | 'create_therapist';
    data: Record<string, any>;
  };
  conversationId?: string;
}

export async function processMessage(
  message: string,
  context: {
    url: string;
    userAgent: string;
    conversationId?: string;
  }
): Promise<AIResponse> {
  try {
    const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-message`;
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ message, context }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error processing message:', error);
    if (error instanceof Error) {
      errorTracker.trackAIError(error, {
        functionCalled: 'processMessage',
        errorType: 'network_error',
      });
    }
    return {
      response: "I apologize, but I'm having trouble processing your request right now. " +
        "Please try again in a moment or use the manual interface instead."
    };
  }
}

// Function to get client details
export async function getClientDetails(clientId: string): Promise<any> {
  try {
    const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-client-details`;
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ clientId }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data.client;
  } catch (error) {
    console.error('Error getting client details:', error);
    throw error;
  }
}

// Function to get therapist details
export async function getTherapistDetails(therapistId: string): Promise<any> {
  try {
    const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-therapist-details`;
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ therapistId }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data.therapist;
  } catch (error) {
    console.error('Error getting therapist details:', error);
    throw error;
  }
}

// Function to get authorization details
export async function getAuthorizationDetails(authorizationId: string): Promise<any> {
  try {
    const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-authorization-details`;
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ authorizationId }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data.authorization;
  } catch (error) {
    console.error('Error getting authorization details:', error);
    throw error;
  }
}