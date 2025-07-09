// Design System Utilities
// Provides consistent UI patterns and component variants

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Button variants
export const buttonVariants = {
  primary: 'bg-primary-600 hover:bg-primary-700 text-white shadow-sm focus:ring-primary-500',
  secondary: 'bg-white hover:bg-gray-50 text-gray-900 border border-gray-300 shadow-sm focus:ring-primary-500',
  outline: 'border border-gray-300 bg-transparent hover:bg-gray-50 text-gray-700 shadow-sm focus:ring-primary-500',
  ghost: 'bg-transparent hover:bg-gray-100 text-gray-700 focus:ring-primary-500',
  danger: 'bg-error-600 hover:bg-error-700 text-white shadow-sm focus:ring-error-500',
  success: 'bg-success-600 hover:bg-success-700 text-white shadow-sm focus:ring-success-500',
  warning: 'bg-warning-600 hover:bg-warning-700 text-white shadow-sm focus:ring-warning-500',
  
  // Dark mode variants
  'primary-dark': 'dark:bg-primary-500 dark:hover:bg-primary-600 dark:text-white dark:focus:ring-primary-400',
  'secondary-dark': 'dark:bg-gray-800 dark:hover:bg-gray-700 dark:text-gray-100 dark:border-gray-600 dark:focus:ring-primary-400',
  'outline-dark': 'dark:border-gray-600 dark:bg-transparent dark:hover:bg-gray-800 dark:text-gray-300 dark:focus:ring-primary-400',
  'ghost-dark': 'dark:bg-transparent dark:hover:bg-gray-800 dark:text-gray-300 dark:focus:ring-primary-400',
  'danger-dark': 'dark:bg-error-500 dark:hover:bg-error-600 dark:text-white dark:focus:ring-error-400',
  'success-dark': 'dark:bg-success-500 dark:hover:bg-success-600 dark:text-white dark:focus:ring-success-400',
  'warning-dark': 'dark:bg-warning-500 dark:hover:bg-warning-600 dark:text-white dark:focus:ring-warning-400',
};

// Button sizes
export const buttonSizes = {
  xs: 'px-2 py-1 text-xs',
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-3 text-base',
  xl: 'px-8 py-4 text-lg',
};

// Input variants
export const inputVariants = {
  default: 'border-gray-300 focus:border-primary-500 focus:ring-primary-500',
  error: 'border-error-300 focus:border-error-500 focus:ring-error-500',
  success: 'border-success-300 focus:border-success-500 focus:ring-success-500',
  warning: 'border-warning-300 focus:border-warning-500 focus:ring-warning-500',
  
  // Dark mode variants
  'default-dark': 'dark:border-gray-600 dark:focus:border-primary-400 dark:focus:ring-primary-400',
  'error-dark': 'dark:border-error-500 dark:focus:border-error-400 dark:focus:ring-error-400',
  'success-dark': 'dark:border-success-500 dark:focus:border-success-400 dark:focus:ring-success-400',
  'warning-dark': 'dark:border-warning-500 dark:focus:border-warning-400 dark:focus:ring-warning-400',
};

// Card variants
export const cardVariants = {
  default: 'bg-white border border-gray-200 rounded-lg shadow-sm',
  elevated: 'bg-white border border-gray-200 rounded-lg shadow-soft',
  soft: 'bg-white border border-gray-200 rounded-lg shadow-soft-lg',
  bordered: 'bg-white border border-gray-300 rounded-lg',
  
  // Dark mode variants
  'default-dark': 'dark:bg-dark-lighter dark:border-gray-700',
  'elevated-dark': 'dark:bg-dark-lighter dark:border-gray-700',
  'soft-dark': 'dark:bg-dark-lighter dark:border-gray-700',
  'bordered-dark': 'dark:bg-dark-lighter dark:border-gray-600',
};

// Badge variants
export const badgeVariants = {
  default: 'bg-gray-100 text-gray-800',
  primary: 'bg-primary-100 text-primary-800',
  secondary: 'bg-gray-100 text-gray-600',
  success: 'bg-success-100 text-success-800',
  warning: 'bg-warning-100 text-warning-800',
  error: 'bg-error-100 text-error-800',
  
  // Dark mode variants
  'default-dark': 'dark:bg-gray-800 dark:text-gray-200',
  'primary-dark': 'dark:bg-primary-900 dark:text-primary-200',
  'secondary-dark': 'dark:bg-gray-800 dark:text-gray-400',
  'success-dark': 'dark:bg-success-900 dark:text-success-200',
  'warning-dark': 'dark:bg-warning-900 dark:text-warning-200',
  'error-dark': 'dark:bg-error-900 dark:text-error-200',
};

// Status colors for sessions
export const sessionStatusColors = {
  scheduled: 'bg-primary-100 text-primary-800 dark:bg-primary-900/30 dark:text-primary-200',
  completed: 'bg-success-100 text-success-800 dark:bg-success-900/30 dark:text-success-200',
  cancelled: 'bg-error-100 text-error-800 dark:bg-error-900/30 dark:text-error-200',
  'no-show': 'bg-warning-100 text-warning-800 dark:bg-warning-900/30 dark:text-warning-200',
};

// Responsive breakpoints
export const breakpoints = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
};

// Common spacing scale
export const spacing = {
  xs: '0.25rem',
  sm: '0.5rem',
  md: '1rem',
  lg: '1.5rem',
  xl: '2rem',
  '2xl': '3rem',
  '3xl': '4rem',
};

// Typography scale
export const typography = {
  h1: 'text-3xl font-bold tracking-tight text-gray-900 dark:text-white',
  h2: 'text-2xl font-semibold tracking-tight text-gray-900 dark:text-white',
  h3: 'text-xl font-semibold text-gray-900 dark:text-white',
  h4: 'text-lg font-semibold text-gray-900 dark:text-white',
  h5: 'text-base font-semibold text-gray-900 dark:text-white',
  h6: 'text-sm font-semibold text-gray-900 dark:text-white',
  
  body: 'text-sm text-gray-600 dark:text-gray-300',
  'body-lg': 'text-base text-gray-600 dark:text-gray-300',
  'body-sm': 'text-xs text-gray-600 dark:text-gray-300',
  
  caption: 'text-xs text-gray-500 dark:text-gray-400',
  label: 'text-sm font-medium text-gray-700 dark:text-gray-300',
  
  muted: 'text-sm text-gray-500 dark:text-gray-400',
  'muted-sm': 'text-xs text-gray-500 dark:text-gray-400',
};

// Layout utilities
export const layout = {
  container: 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8',
  'container-narrow': 'max-w-2xl mx-auto px-4 sm:px-6 lg:px-8',
  'container-wide': 'max-w-full mx-auto px-4 sm:px-6 lg:px-8',
  
  sidebar: 'fixed lg:static inset-y-0 left-0 z-40 w-64 transform lg:transform-none transition-transform duration-200 ease-in-out',
  'main-content': 'flex-1 p-4 lg:p-8 w-full lg:ml-64',
  
  modal: 'fixed inset-0 z-50 overflow-y-auto',
  'modal-overlay': 'fixed inset-0 bg-black bg-opacity-50 transition-opacity',
  'modal-content': 'flex min-h-full items-center justify-center p-4 text-center sm:p-0',
  'modal-panel': 'relative transform overflow-hidden rounded-lg bg-white px-4 pb-4 pt-5 text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-lg sm:p-6',
};

// Animation utilities
export const animations = {
  'fade-in': 'animate-fade-in',
  'slide-in': 'animate-slide-in',
  'bounce-subtle': 'animate-bounce-subtle',
  
  // Transition utilities
  'transition-all': 'transition-all duration-200 ease-in-out',
  'transition-colors': 'transition-colors duration-200 ease-in-out',
  'transition-transform': 'transition-transform duration-200 ease-in-out',
  'transition-opacity': 'transition-opacity duration-200 ease-in-out',
};

// Focus states
export const focusStates = {
  default: 'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500',
  ring: 'focus:outline-none focus:ring-2 focus:ring-primary-500',
  'ring-offset': 'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500',
  inset: 'focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary-500',
};

// Accessibility utilities
export const accessibility = {
  'sr-only': 'sr-only',
  'not-sr-only': 'not-sr-only',
  'focus-visible': 'focus-visible:ring-2 focus-visible:ring-primary-500',
  'motion-safe': 'motion-safe:animate-pulse',
  'motion-reduce': 'motion-reduce:animate-none',
};

// Common component patterns
export const patterns = {
  // Form group
  'form-group': 'space-y-1',
  'form-label': cn(typography.label, 'block'),
  'form-input': 'w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm',
  'form-error': 'text-sm text-error-600 dark:text-error-400',
  'form-help': 'text-sm text-gray-500 dark:text-gray-400',
  
  // Button group
  'button-group': 'inline-flex rounded-md shadow-sm',
  'button-group-item': 'relative inline-flex items-center border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:z-10 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500',
  
  // Navigation
  'nav-link': 'flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors duration-150 ease-in-out',
  'nav-link-active': 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-200',
  'nav-link-inactive': 'text-gray-600 hover:text-gray-900 hover:bg-gray-50 dark:text-gray-400 dark:hover:text-gray-100 dark:hover:bg-gray-800',
  
  // Loading states
  'loading-spinner': 'animate-spin rounded-full h-4 w-4 border-2 border-gray-300 border-t-primary-600',
  'loading-skeleton': 'animate-pulse bg-gray-200 dark:bg-gray-700 rounded',
  'loading-overlay': 'absolute inset-0 bg-white bg-opacity-75 flex items-center justify-center',
  
  // Status indicators
  'status-dot': 'h-2 w-2 rounded-full',
  'status-online': 'bg-success-500',
  'status-offline': 'bg-gray-400',
  'status-busy': 'bg-error-500',
  'status-away': 'bg-warning-500',
};

// Responsive utilities
export function responsive(baseClass: string, responsiveClasses: Record<string, string>) {
  return cn(
    baseClass,
    ...Object.entries(responsiveClasses).map(([breakpoint, className]) => 
      `${breakpoint}:${className}`
    )
  );
}

// Theme-aware utility
export function themeAware(lightClass: string, darkClass: string) {
  return cn(lightClass, darkClass);
}

// Size utility
export function withSize(baseClass: string, size: keyof typeof buttonSizes) {
  return cn(baseClass, buttonSizes[size]);
}

// Variant utility
export function withVariant(baseClass: string, variant: keyof typeof buttonVariants) {
  return cn(baseClass, buttonVariants[variant]);
}