import React, { forwardRef } from 'react';
import { type ClassValue } from 'clsx';
import { 
  cn, 
  buttonVariants, 
  buttonSizes, 
  focusStates, 
  animations,
  accessibility
} from '../../lib/design-system';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success' | 'warning';
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  isLoading?: boolean;
  loadingText?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
  children: React.ReactNode;
  className?: string;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(({
  variant = 'primary',
  size = 'md',
  isLoading = false,
  loadingText = 'Loading...',
  leftIcon,
  rightIcon,
  fullWidth = false,
  children,
  className,
  disabled,
  ...props
}, ref) => {
  const baseClasses = cn(
    // Base button styles
    'inline-flex items-center justify-center font-medium rounded-md',
    'transition-colors duration-200 ease-in-out',
    'disabled:opacity-50 disabled:cursor-not-allowed',
    focusStates.default,
    
    // Size variations
    buttonSizes[size],
    
    // Variant styles (light and dark mode)
    buttonVariants[variant],
    buttonVariants[`${variant}-dark` as keyof typeof buttonVariants],
    
    // Full width
    fullWidth && 'w-full',
    
    // Loading state
    isLoading && 'cursor-not-allowed',
    
    // Accessibility
    accessibility['focus-visible'],
    
    // Custom classes
    className
  );

  const iconClasses = cn(
    'flex-shrink-0',
    size === 'xs' && 'h-3 w-3',
    size === 'sm' && 'h-4 w-4',
    size === 'md' && 'h-4 w-4',
    size === 'lg' && 'h-5 w-5',
    size === 'xl' && 'h-5 w-5'
  );

  const LoadingSpinner = () => (
    <svg 
      className={cn(iconClasses, 'animate-spin')} 
      fill="none" 
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle 
        className="opacity-25" 
        cx="12" 
        cy="12" 
        r="10" 
        stroke="currentColor" 
        strokeWidth="4"
      />
      <path 
        className="opacity-75" 
        fill="currentColor" 
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );

  const content = (
    <>
      {isLoading && (
        <LoadingSpinner />
      )}
      {!isLoading && leftIcon && (
        <span className={cn(iconClasses, children && 'mr-2')}>
          {leftIcon}
        </span>
      )}
      <span className={cn(isLoading && 'ml-2')}>
        {isLoading ? loadingText : children}
      </span>
      {!isLoading && rightIcon && (
        <span className={cn(iconClasses, children && 'ml-2')}>
          {rightIcon}
        </span>
      )}
    </>
  );

  return (
    <button
      ref={ref}
      className={baseClasses}
      disabled={disabled || isLoading}
      aria-disabled={disabled || isLoading}
      {...props}
    >
      {content}
    </button>
  );
});

Button.displayName = 'Button';

export default Button;