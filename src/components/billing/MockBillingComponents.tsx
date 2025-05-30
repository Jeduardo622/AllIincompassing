import React from 'react';
import { CreditCard, FileText, Download, CheckCircle, AlertCircle, Clock, Trash2 } from 'lucide-react';

// Mock Payment Methods List
export const MockPaymentMethodList = ({ 
  paymentMethods, 
  isLoading, 
  onDelete, 
  onSetDefault 
}: {
  paymentMethods: any[];
  isLoading: boolean;
  onDelete: (id: string) => void;
  onSetDefault: (id: string) => void;
}) => {
  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (paymentMethods.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500 dark:text-gray-400">
        No payment methods found
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {paymentMethods.map((method) => (
        <div
          key={method.id}
          className={`p-4 border rounded-lg ${
            method.is_default
              ? 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20'
              : 'border-gray-200 dark:border-gray-700'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <div className="mr-4 text-gray-500 dark:text-gray-400">
                <CreditCard className="h-8 w-8" />
              </div>
              <div>
                <div className="font-medium text-gray-900 dark:text-white flex items-center">
                  {method.card.brand === 'visa' ? '💳 Visa' : 
                   method.card.brand === 'mastercard' ? '💳 Mastercard' : 
                   method.card.brand === 'amex' ? '💳 American Express' : 
                   method.card.brand === 'discover' ? '💳 Discover' : 
                   '💳 Card'} •••• {method.card.last4}
                  {method.is_default && (
                    <span className="ml-2 text-xs bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 px-2 py-0.5 rounded-full">
                      Default
                    </span>
                  )}
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  Expires {method.card.exp_month.toString().padStart(2, '0')}/{method.card.exp_year}
                </div>
                {method.billing_details.name && (
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    {method.billing_details.name}
                  </div>
                )}
              </div>
            </div>
            <div className="flex space-x-2">
              {!method.is_default && (
                <button
                  onClick={() => onSetDefault(method.id)}
                  className="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                >
                  Set Default
                </button>
              )}
              <button
                onClick={() => onDelete(method.id)}
                className="text-sm text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

// Mock Invoice List
export const MockInvoiceList = ({ 
  invoices, 
  isLoading 
}: {
  invoices: any[];
  isLoading: boolean;
}) => {
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'paid':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
            <CheckCircle className="w-3 h-3 mr-1" />
            Paid
          </span>
        );
      case 'open':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
            <Clock className="w-3 h-3 mr-1" />
            Open
          </span>
        );
      case 'uncollectible':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
            <AlertCircle className="w-3 h-3 mr-1" />
            Uncollectible
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200">
            {status}
          </span>
        );
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (invoices.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500 dark:text-gray-400">
        No invoices found
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
        <thead className="bg-gray-50 dark:bg-gray-800">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Invoice
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Date
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Amount
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Status
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="bg-white dark:bg-dark-lighter divide-y divide-gray-200 dark:divide-gray-700">
          {invoices.map((invoice) => (
            <tr key={invoice.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="flex items-center">
                  <FileText className="h-5 w-5 text-gray-400 mr-3" />
                  <div className="text-sm font-medium text-gray-900 dark:text-white">
                    {invoice.number}
                  </div>
                  {invoice.description && (
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 ml-2">
                      {invoice.description}
                    </div>
                  )}
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="text-sm text-gray-900 dark:text-white">
                  {new Date(invoice.created * 1000).toLocaleDateString()}
                </div>
                {invoice.due_date && (
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    Due: {new Date(invoice.due_date * 1000).toLocaleDateString()}
                  </div>
                )}
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="text-sm font-medium text-gray-900 dark:text-white">
                  ${(invoice.amount_due / 100).toFixed(2)}
                </div>
                {invoice.amount_paid > 0 && invoice.amount_paid < invoice.amount_due && (
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    Paid: ${(invoice.amount_paid / 100).toFixed(2)}
                  </div>
                )}
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                {getStatusBadge(invoice.status)}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                {invoice.pdf && (
                  <a
                    href={invoice.pdf}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300 flex items-center"
                  >
                    <Download className="h-4 w-4 mr-1" />
                    PDF
                  </a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// Mock Payment Form
export const MockPaymentForm = ({ 
  onSuccess 
}: { 
  onSuccess: () => void 
}) => {
  return (
    <div className="text-center py-4">
      <p className="text-gray-600 dark:text-gray-300 mb-4">
        This is a placeholder for the payment method form. In a production environment, this would be connected to Stripe.
      </p>
      <button
        onClick={onSuccess}
        className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
      >
        Add Payment Method (Mock)
      </button>
    </div>
  );
};

// Mock Checkout Form
export const MockCheckoutForm = ({ 
  amount, 
  description, 
  onSuccess 
}: { 
  amount: number;
  description: string;
  onSuccess: () => void;
}) => {
  return (
    <div className="text-center py-4">
      <p className="text-gray-600 dark:text-gray-300 mb-4">
        This is a placeholder for the payment form. In a production environment, this would be connected to Stripe.
      </p>
      <div className="mb-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
        <p className="font-medium text-gray-900 dark:text-white">{description}</p>
        <p className="text-2xl font-bold text-gray-900 dark:text-white mt-2">
          ${(amount / 100).toFixed(2)}
        </p>
      </div>
      <button
        onClick={onSuccess}
        className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
      >
        Complete Payment (Mock)
      </button>
    </div>
  );
};