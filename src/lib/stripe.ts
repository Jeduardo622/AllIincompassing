import { loadStripe } from '@stripe/stripe-js';
import { supabase } from './supabase';

// Initialize Stripe with your publishable key
const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);

export const getStripe = () => stripePromise;

// Create a checkout session
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

// Create a subscription
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

// Get client payment methods
export const getClientPaymentMethods = async (clientId: string) => {
  try {
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

// Create a payment intent for one-time payments
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

// Get client invoices
export const getClientInvoices = async (clientId: string) => {
  try {
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