import React, { useState } from 'react';
import { 
  CreditCard, 
  FileText, 
  DollarSign, 
  Plus, 
  Clock, 
  CheckCircle, 
  AlertCircle,
  Trash2
} from 'lucide-react';

export default function Billing() {
  const [activeTab, setActiveTab] = useState('plans');

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
                <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
                  <p className="text-gray-600 dark:text-gray-300">
                    Stripe integration has been removed. Please contact support for subscription management.
                  </p>
                </div>
              </div>

              <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
                Available Plans
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Basic Plan */}
                <div className="rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
                  <div className="p-6 bg-white dark:bg-dark-lighter">
                    <h3 className="text-xl font-bold text-gray-900 dark:text-white">Basic</h3>
                    <p className="mt-2 text-gray-600 dark:text-gray-300">For small practices with up to 5 therapists</p>
                    <div className="mt-4 flex items-baseline">
                      <span className="text-3xl font-extrabold text-gray-900 dark:text-white">$49</span>
                      <span className="ml-1 text-xl font-medium text-gray-500 dark:text-gray-400">/month</span>
                    </div>
                    <ul className="mt-6 space-y-4">
                      <li className="flex items-start">
                        <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0 mr-3" />
                        <p className="ml-3 text-base text-gray-700 dark:text-gray-300">Up to 5 therapist accounts</p>
                      </li>
                      <li className="flex items-start">
                        <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0 mr-3" />
                        <p className="ml-3 text-base text-gray-700 dark:text-gray-300">Unlimited clients</p>
                      </li>
                      <li className="flex items-start">
                        <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0 mr-3" />
                        <p className="ml-3 text-base text-gray-700 dark:text-gray-300">Basic scheduling</p>
                      </li>
                      <li className="flex items-start">
                        <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0 mr-3" />
                        <p className="ml-3 text-base text-gray-700 dark:text-gray-300">Client portal</p>
                      </li>
                      <li className="flex items-start">
                        <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0 mr-3" />
                        <p className="ml-3 text-base text-gray-700 dark:text-gray-300">Basic reporting</p>
                      </li>
                    </ul>
                    <button className="mt-8 w-full bg-white text-blue-600 border-blue-600 hover:bg-blue-50 dark:bg-dark-lighter dark:text-blue-400 dark:border-blue-500 dark:hover:bg-gray-800 border rounded-md shadow-sm px-4 py-2 flex items-center justify-center text-base font-medium">
                      <CreditCard className="mr-2 h-5 w-5" />
                      Contact Sales
                    </button>
                  </div>
                </div>
                
                {/* Professional Plan */}
                <div className="rounded-lg overflow-hidden border-2 border-blue-500 dark:border-blue-400 shadow-lg transform scale-105">
                  <div className="bg-blue-500 text-white text-center py-1 text-sm font-medium">
                    Most Popular
                  </div>
                  <div className="p-6 bg-white dark:bg-dark-lighter">
                    <h3 className="text-xl font-bold text-gray-900 dark:text-white">Professional</h3>
                    <p className="mt-2 text-gray-600 dark:text-gray-300">For growing practices with up to 15 therapists</p>
                    <div className="mt-4 flex items-baseline">
                      <span className="text-3xl font-extrabold text-gray-900 dark:text-white">$99</span>
                      <span className="ml-1 text-xl font-medium text-gray-500 dark:text-gray-400">/month</span>
                    </div>
                    <ul className="mt-6 space-y-4">
                      <li className="flex items-start">
                        <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0 mr-3" />
                        <p className="ml-3 text-base text-gray-700 dark:text-gray-300">Up to 15 therapist accounts</p>
                      </li>
                      <li className="flex items-start">
                        <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0 mr-3" />
                        <p className="ml-3 text-base text-gray-700 dark:text-gray-300">Unlimited clients</p>
                      </li>
                      <li className="flex items-start">
                        <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0 mr-3" />
                        <p className="ml-3 text-base text-gray-700 dark:text-gray-300">Advanced scheduling</p>
                      </li>
                      <li className="flex items-start">
                        <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0 mr-3" />
                        <p className="ml-3 text-base text-gray-700 dark:text-gray-300">Client portal</p>
                      </li>
                      <li className="flex items-start">
                        <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0 mr-3" />
                        <p className="ml-3 text-base text-gray-700 dark:text-gray-300">Comprehensive reporting</p>
                      </li>
                      <li className="flex items-start">
                        <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0 mr-3" />
                        <p className="ml-3 text-base text-gray-700 dark:text-gray-300">Document management</p>
                      </li>
                    </ul>
                    <button className="mt-8 w-full bg-blue-600 text-white hover:bg-blue-700 border border-transparent rounded-md shadow-sm px-4 py-2 flex items-center justify-center text-base font-medium">
                      <CreditCard className="mr-2 h-5 w-5" />
                      Contact Sales
                    </button>
                  </div>
                </div>
                
                {/* Enterprise Plan */}
                <div className="rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
                  <div className="p-6 bg-white dark:bg-dark-lighter">
                    <h3 className="text-xl font-bold text-gray-900 dark:text-white">Enterprise</h3>
                    <p className="mt-2 text-gray-600 dark:text-gray-300">For large practices with unlimited therapists</p>
                    <div className="mt-4 flex items-baseline">
                      <span className="text-3xl font-extrabold text-gray-900 dark:text-white">$199</span>
                      <span className="ml-1 text-xl font-medium text-gray-500 dark:text-gray-400">/month</span>
                    </div>
                    <ul className="mt-6 space-y-4">
                      <li className="flex items-start">
                        <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0 mr-3" />
                        <p className="ml-3 text-base text-gray-700 dark:text-gray-300">Unlimited therapist accounts</p>
                      </li>
                      <li className="flex items-start">
                        <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0 mr-3" />
                        <p className="ml-3 text-base text-gray-700 dark:text-gray-300">Unlimited clients</p>
                      </li>
                      <li className="flex items-start">
                        <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0 mr-3" />
                        <p className="ml-3 text-base text-gray-700 dark:text-gray-300">Advanced scheduling</p>
                      </li>
                      <li className="flex items-start">
                        <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0 mr-3" />
                        <p className="ml-3 text-base text-gray-700 dark:text-gray-300">Client portal</p>
                      </li>
                      <li className="flex items-start">
                        <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0 mr-3" />
                        <p className="ml-3 text-base text-gray-700 dark:text-gray-300">Custom reporting</p>
                      </li>
                      <li className="flex items-start">
                        <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0 mr-3" />
                        <p className="ml-3 text-base text-gray-700 dark:text-gray-300">Document management</p>
                      </li>
                      <li className="flex items-start">
                        <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0 mr-3" />
                        <p className="ml-3 text-base text-gray-700 dark:text-gray-300">API access</p>
                      </li>
                      <li className="flex items-start">
                        <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0 mr-3" />
                        <p className="ml-3 text-base text-gray-700 dark:text-gray-300">Dedicated support</p>
                      </li>
                    </ul>
                    <button className="mt-8 w-full bg-white text-blue-600 border-blue-600 hover:bg-blue-50 dark:bg-dark-lighter dark:text-blue-400 dark:border-blue-500 dark:hover:bg-gray-800 border rounded-md shadow-sm px-4 py-2 flex items-center justify-center text-base font-medium">
                      <CreditCard className="mr-2 h-5 w-5" />
                      Contact Sales
                    </button>
                  </div>
                </div>
              </div>
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
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 flex items-center"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Contact Support
                </button>
              </div>
              
              <div className="bg-gray-50 dark:bg-gray-800 p-6 rounded-lg text-center">
                <CreditCard className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                  Stripe integration has been removed
                </h3>
                <p className="text-gray-600 dark:text-gray-300 mb-4">
                  Payment method management is no longer available through this interface.
                  Please contact our support team for assistance with payment methods.
                </p>
                <button
                  className="px-4 py-2 text-sm font-medium text-blue-600 bg-blue-100 dark:bg-blue-900/20 dark:text-blue-300 rounded-md hover:bg-blue-200 dark:hover:bg-blue-900/30 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  Contact Support
                </button>
              </div>
            </div>
          )}

          {/* Invoices Tab */}
          {activeTab === 'invoices' && (
            <div>
              <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-6">
                Invoices & Receipts
              </h2>
              
              <div className="bg-gray-50 dark:bg-gray-800 p-6 rounded-lg text-center">
                <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                  Stripe integration has been removed
                </h3>
                <p className="text-gray-600 dark:text-gray-300 mb-4">
                  Invoice management is no longer available through this interface.
                  Please contact our support team for assistance with invoices and receipts.
                </p>
                <button
                  className="px-4 py-2 text-sm font-medium text-blue-600 bg-blue-100 dark:bg-blue-900/20 dark:text-blue-300 rounded-md hover:bg-blue-200 dark:hover:bg-blue-900/30 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  Contact Support
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}