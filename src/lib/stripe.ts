import { loadStripe } from '@stripe/stripe-js';
import { supabase } from './supabase';

// Initialize Stripe with your publishable key, with fallback for development
const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || 'pk_test_placeholder');

export const getStripe = () => stripePromise;

// Create a checkout session with error handling for missing environment variables
export const createCheckoutSession = async ({
  priceId,
  clientId,
  successUrl,
  cancelUrl,
}: {
  priceId: string;
  clientId: string;
  successUrl: string;
  cancelUrl: string;
}) => {
  try {
    // Check if we're in development mode without proper environment variables
    if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
      console.warn('Development mode: Using mock checkout session');
      return { 
        sessionId: 'mock-session-id',
        url: successUrl 
      };
    }

    const { data, error } = await supabase.functions.invoke('create-checkout-session', {
      body: {
        priceId,
        clientId,
        successUrl,
        cancelUrl,
      },
    });

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error creating checkout session:', error);
    throw error;
  }
};

// Create a subscription with error handling
export const createSubscription = async ({
  priceId,
  clientId,
  paymentMethodId,
}: {
  priceId: string;
  clientId: string;
  paymentMethodId: string;
}) => {
  try {
    // Check if we're in development mode without proper environment variables
    if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
      console.warn('Development mode: Using mock subscription');
      return { 
        subscription: {
          id: 'mock-subscription-id',
          status: 'active'
        },
        message: 'Subscription created successfully (mock)' 
      };
    }

    const { data, error } = await supabase.functions.invoke('create-subscription', {
      body: {
        priceId,
        clientId,
        paymentMethodId,
      },
    });

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error creating subscription:', error);
    throw error;
  }
};

// Get client payment methods with error handling
export const getClientPaymentMethods = async (clientId: string) => {
  try {
    // Check if we're in development mode without proper environment variables
    if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
      console.warn('Development mode: Using mock payment methods');
      return { 
        payment_methods: [
          {
            id: 'mock-pm-1',
            card: {
              brand: 'visa',
              last4: '4242',
              exp_month: 12,
              exp_year: 2025
            },
            billing_details: {
              name: 'Mock User',
              email: 'mock@example.com'
            },
            created: Date.now() / 1000,
            is_default: true
          }
        ] 
      };
    }

    const { data, error } = await supabase.functions.invoke('get-payment-methods', {
      body: { clientId },
    });

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error fetching payment methods:', error);
    throw error;
  }
};

// Create a payment intent for one-time payments with error handling
export const createPaymentIntent = async ({
  amount,
  clientId,
  description,
  metadata = {},
}: {
  amount: number;
  clientId: string;
  description: string;
  metadata?: Record<string, string>;
}) => {
  try {
    // Check if we're in development mode without proper environment variables
    if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
      console.warn('Development mode: Using mock payment intent');
      return { 
        clientSecret: 'mock_client_secret_placeholder' 
      };
    }

    const { data, error } = await supabase.functions.invoke('create-payment-intent', {
      body: {
        amount,
        clientId,
        description,
        metadata,
      },
    });

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error creating payment intent:', error);
    throw error;
  }
};

// Get client invoices with error handling
export const getClientInvoices = async (clientId: string) => {
  try {
    // Check if we're in development mode without proper environment variables
    if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
      console.warn('Development mode: Using mock invoices');
      return { 
        invoices: [
          {
            id: 'mock-invoice-1',
            number: 'INV-001',
            amount_due: 9900,
            amount_paid: 9900,
            status: 'paid',
            created: Date.now() / 1000,
            due_date: (Date.now() + 30 * 24 * 60 * 60 * 1000) / 1000,
            pdf: 'https://example.com/invoice.pdf',
            description: 'Monthly subscription'
          }
        ] 
      };
    }

    const { data, error } = await supabase.functions.invoke('get-invoices', {
      body: { clientId },
    });

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error fetching invoices:', error);
    throw error;
  }
};