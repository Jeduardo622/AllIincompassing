import React, { useState } from 'react';
import { CreditCard, FileText, DollarSign, Plus } from 'lucide-react';
import BillingPlanCard from '../components/billing/BillingPlanCard';
import { MockPaymentMethodList, MockInvoiceList, MockPaymentForm, MockCheckoutForm } from '../components/billing/MockBillingComponents';

// Billing plans
const BILLING_PLANS = [
  {
    id: 'basic',
    name: 'Basic',
    description: 'For small practices with up to 5 therapists',
    price: 49,
    interval: 'month',
    features: [
      'Up to 5 therapist accounts',
      'Unlimited clients',
      'Basic scheduling',
      'Client portal',
      'Basic reporting'
    ],
    priceId: 'price_basic',
    popular: false
  },
  {
    id: 'professional',
    name: 'Professional',
    description: 'For growing practices with up to 15 therapists',
    price: 99,
    interval: 'month',
    features: [
      'Up to 15 therapist accounts',
      'Unlimited clients',
      'Advanced scheduling',
      'Client portal',
      'Comprehensive reporting',
      'Insurance billing',
      'Document management'
    ],
    priceId: 'price_professional',
    popular: true
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    description: 'For large practices with unlimited therapists',
    price: 199,
    interval: 'month',
    features: [
      'Unlimited therapist accounts',
      'Unlimited clients',
      'Advanced scheduling',
      'Client portal',
      'Custom reporting',
      'Insurance billing',
      'Document management',
      'API access',
      'Dedicated support'
    ],
    priceId: 'price_enterprise',
    popular: false
  }
];

// Mock data for development
const MOCK_PAYMENT_METHODS = [
  {
    id: 'pm_mock_1',
    card: {
      brand: 'visa',
      last4: '4242',
      exp_month: 12,
      exp_year: 2025
    },
    billing_details: {
      name: 'John Doe',
      email: 'john@example.com'
    },
    created: Date.now() / 1000,
    is_default: true
  },
  {
    id: 'pm_mock_2',
    card: {
      brand: 'mastercard',
      last4: '5555',
      exp_month: 10,
      exp_year: 2024
    },
    billing_details: {
      name: 'John Doe',
      email: 'john@example.com'
    },
    created: Date.now() / 1000,
    is_default: false
  }
];

const MOCK_INVOICES = [
  {
    id: 'in_mock_1',
    number: 'INV-001',
    amount_due: 9900,
    amount_paid: 9900,
    status: 'paid',
    created: Date.now() / 1000,
    due_date: (Date.now() + 30 * 24 * 60 * 60 * 1000) / 1000,
    pdf: 'https://example.com/invoice.pdf',
    description: 'Professional Plan - Monthly'
  },
  {
    id: 'in_mock_2',
    number: 'INV-002',
    amount_due: 9900,
    amount_paid: 0,
    status: 'open',
    created: (Date.now() - 15 * 24 * 60 * 60 * 1000) / 1000,
    due_date: (Date.now() + 15 * 24 * 60 * 60 * 1000) / 1000,
    pdf: 'https://example.com/invoice.pdf',
    description: 'Professional Plan - Monthly'
  }
];

const MOCK_SUBSCRIPTION = {
  id: 'sub_mock_1',
  status: 'active',
  current_period_end: (Date.now() + 30 * 24 * 60 * 60 * 1000) / 1000,
  items: {
    data: [
      {
        id: 'si_mock_1',
        price: {
          id: 'price_professional',
          unit_amount: 9900,
          recurring: {
            interval: 'month'
          }
        }
      }
    ]
  }
};

export default function Billing() {
  const [activeTab, setActiveTab] = useState('plans');
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [showAddPaymentMethod, setShowAddPaymentMethod] = useState(false);
  const [clientId] = useState('current');
  const [isLoading, setIsLoading] = useState(false);

  // Use mock data instead of fetching from API
  const paymentMethods = MOCK_PAYMENT_METHODS;
  const invoices = MOCK_INVOICES;
  const subscription = MOCK_SUBSCRIPTION;
  const isLoadingPaymentMethods = false;
  const isLoadingInvoices = false;
  const isLoadingSubscription = false;

  // Handle plan selection
  const handleSelectPlan = (plan: any) => {
    setSelectedPlan(plan.id);
  };

  // Handle payment method deletion
  const handleDeletePaymentMethod = async (paymentMethodId: string) => {
    if (!window.confirm('Are you sure you want to delete this payment method?')) {
      return;
    }

    setIsLoading(true);
    try {
      console.log('Deleting payment method:', paymentMethodId);
      // In a real app, this would call the API
      setTimeout(() => {
        setIsLoading(false);
      }, 1000);
    } catch (error) {
      console.error('Error deleting payment method:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle setting default payment method
  const handleSetDefaultPaymentMethod = async (paymentMethodId: string) => {
    setIsLoading(true);
    try {
      console.log('Setting default payment method:', paymentMethodId);
      // In a real app, this would call the API
      setTimeout(() => {
        setIsLoading(false);
      }, 1000);
    } catch (error) {
      console.error('Error setting default payment method:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle payment method form submission
  const handlePaymentMethodAdded = () => {
    setShowAddPaymentMethod(false);
    console.log('Payment method added successfully');
  };

  // Determine if user has an active subscription
  const hasActiveSubscription = subscription && subscription.status === 'active';

  // Get current plan from subscription
  const getCurrentPlan = () => {
    if (!hasActiveSubscription) return null;
    
    const priceId = subscription.items.data[0].price.id;
    return BILLING_PLANS.find(plan => plan.priceId === priceId) || null;
  };

  const currentPlan = getCurrentPlan();

  return (
    <div className="h-full">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Billing & Payments</h1>
      </div>

      <div className="bg-white dark:bg-dark-lighter rounded-lg shadow mb-6">
        <div className="border-b dark:border-gray-700">
          <nav className="flex -mb-px">
            <button
              onClick={() => setActiveTab('plans')}
              className={`
                group inline-flex items-center px-6 py-4 border-b-2 font-medium text-sm
                ${
                  activeTab === 'plans'
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
                }
              `}
            >
              <DollarSign className={`
                -ml-1 mr-2 h-5 w-5
                ${
                  activeTab === 'plans'
                    ? 'text-blue-500 dark:text-blue-400'
                    : 'text-gray-400 group-hover:text-gray-500 dark:text-gray-500 dark:group-hover:text-gray-400'
                }
              `} />
              Subscription Plans
            </button>
            <button
              onClick={() => setActiveTab('payment-methods')}
              className={`
                group inline-flex items-center px-6 py-4 border-b-2 font-medium text-sm
                ${
                  activeTab === 'payment-methods'
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
                }
              `}
            >
              <CreditCard className={`
                -ml-1 mr-2 h-5 w-5
                ${
                  activeTab === 'payment-methods'
                    ? 'text-blue-500 dark:text-blue-400'
                    : 'text-gray-400 group-hover:text-gray-500 dark:text-gray-500 dark:group-hover:text-gray-400'
                }
              `} />
              Payment Methods
            </button>
            <button
              onClick={() => setActiveTab('invoices')}
              className={`
                group inline-flex items-center px-6 py-4 border-b-2 font-medium text-sm
                ${
                  activeTab === 'invoices'
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
                }
              `}
            >
              <FileText className={`
                -ml-1 mr-2 h-5 w-5
                ${
                  activeTab === 'invoices'
                    ? 'text-blue-500 dark:text-blue-400'
                    : 'text-gray-400 group-hover:text-gray-500 dark:text-gray-500 dark:group-hover:text-gray-400'
                }
              `} />
              Invoices & Receipts
            </button>
          </nav>
        </div>

        <div className="p-6">
          {/* Subscription Plans Tab */}
          {activeTab === 'plans' && (
            <div>
              <div className="mb-6">
                <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                  Current Subscription
                </h2>
                {isLoadingSubscription ? (
                  <div className="flex justify-center py-4">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                  </div>
                ) : hasActiveSubscription ? (
                  <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-lg font-medium text-blue-900 dark:text-blue-100">
                          {currentPlan?.name || 'Custom'} Plan
                        </h3>
                        <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                          Your subscription renews on {new Date(subscription.current_period_end * 1000).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="text-right">
                        <div className="text-2xl font-bold text-blue-900 dark:text-blue-100">
                          ${((subscription.items.data[0].price.unit_amount || 0) / 100).toFixed(2)}
                        </div>
                        <div className="text-sm text-blue-700 dark:text-blue-300">
                          per {subscription.items.data[0].price.recurring.interval}
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 flex justify-end">
                      <button
                        className="px-4 py-2 text-sm font-medium text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/30 rounded-md hover:bg-blue-200 dark:hover:bg-blue-900/50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                      >
                        Manage Subscription
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
                    <p className="text-gray-600 dark:text-gray-300">
                      You don't have an active subscription. Choose a plan below to get started.
                    </p>
                  </div>
                )}
              </div>

              <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
                Available Plans
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {BILLING_PLANS.map((plan) => (
                  <BillingPlanCard
                    key={plan.id}
                    plan={plan}
                    onSelect={handleSelectPlan}
                    isSelected={selectedPlan === plan.id}
                  />
                ))}
              </div>

              {selectedPlan && (
                <div className="mt-8">
                  <div className="bg-gray-50 dark:bg-gray-800 p-6 rounded-lg">
                    <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
                      Payment Details
                    </h3>
                    {showPaymentForm ? (
                      <MockCheckoutForm
                        amount={BILLING_PLANS.find(p => p.id === selectedPlan)?.price * 100 || 0}
                        description={`Subscription to ${BILLING_PLANS.find(p => p.id === selectedPlan)?.name} Plan`}
                        onSuccess={() => {
                          setShowPaymentForm(false);
                          setSelectedPlan(null);
                        }}
                      />
                    ) : (
                      <div className="flex justify-end">
                        <button
                          onClick={() => setShowPaymentForm(true)}
                          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                        >
                          Proceed to Payment
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Payment Methods Tab */}
          {activeTab === 'payment-methods' && (
            <div>
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-lg font-medium text-gray-900 dark:text-white">
                  Payment Methods
                </h2>
                <button
                  onClick={() => setShowAddPaymentMethod(true)}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 flex items-center"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add Payment Method
                </button>
              </div>

              {showAddPaymentMethod ? (
                <div className="bg-white dark:bg-dark-lighter p-6 border border-gray-200 dark:border-gray-700 rounded-lg mb-6">
                  <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
                    Add New Payment Method
                  </h3>
                  <MockPaymentForm onSuccess={handlePaymentMethodAdded} />
                </div>
              ) : (
                <MockPaymentMethodList
                  paymentMethods={paymentMethods}
                  isLoading={isLoadingPaymentMethods || isLoading}
                  onDelete={handleDeletePaymentMethod}
                  onSetDefault={handleSetDefaultPaymentMethod}
                />
              )}
            </div>
          )}

          {/* Invoices Tab */}
          {activeTab === 'invoices' && (
            <div>
              <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-6">
                Invoices & Receipts
              </h2>
              <MockInvoiceList
                invoices={invoices}
                isLoading={isLoadingInvoices}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}