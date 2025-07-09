// Accessibility utilities for improved user experience
// Provides keyboard navigation, focus management, and ARIA helpers

import React, { useEffect, useRef, useCallback, useState } from 'react';

// Keyboard navigation utilities
export const KEYBOARD_KEYS = {
  ENTER: 'Enter',
  SPACE: ' ',
  TAB: 'Tab',
  ESCAPE: 'Escape',
  ARROW_UP: 'ArrowUp',
  ARROW_DOWN: 'ArrowDown',
  ARROW_LEFT: 'ArrowLeft',
  ARROW_RIGHT: 'ArrowRight',
  HOME: 'Home',
  END: 'End',
  PAGE_UP: 'PageUp',
  PAGE_DOWN: 'PageDown',
} as const;

// Focus management hook
export function useFocusManagement(isOpen: boolean, autoFocus = true) {
  const containerRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      // Store the currently focused element
      previousFocusRef.current = document.activeElement as HTMLElement;
      
      if (autoFocus) {
        // Focus the container or first focusable element
        setTimeout(() => {
          if (containerRef.current) {
            const firstFocusable = getFocusableElements(containerRef.current)[0];
            if (firstFocusable) {
              firstFocusable.focus();
            } else {
              containerRef.current.focus();
            }
          }
        }, 100);
      }
    } else {
      // Restore focus to the previously focused element
      if (previousFocusRef.current) {
        previousFocusRef.current.focus();
      }
    }
  }, [isOpen, autoFocus]);

  return { containerRef, previousFocusRef };
}

// Focus trap hook for modals and dropdowns
export function useFocusTrap(isActive: boolean, containerRef: React.RefObject<HTMLElement>) {
  useEffect(() => {
    if (!isActive || !containerRef.current) return;

    const handleTabKey = (event: KeyboardEvent) => {
      if (event.key !== KEYBOARD_KEYS.TAB) return;

      const focusableElements = getFocusableElements(containerRef.current!);
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (event.shiftKey) {
        // Shift + Tab
        if (document.activeElement === firstElement) {
          lastElement?.focus();
          event.preventDefault();
        }
      } else {
        // Tab
        if (document.activeElement === lastElement) {
          firstElement?.focus();
          event.preventDefault();
        }
      }
    };

    document.addEventListener('keydown', handleTabKey);
    return () => document.removeEventListener('keydown', handleTabKey);
  }, [isActive, containerRef]);
}

// Get all focusable elements within a container
export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const focusableSelectors = [
    'button:not([disabled])',
    '[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
    '[contenteditable="true"]',
  ].join(', ');

  return Array.from(container.querySelectorAll(focusableSelectors));
}

// Keyboard navigation for menus and lists
export function useKeyboardNavigation(
  items: Array<{ id: string; disabled?: boolean }>,
  onSelect: (id: string) => void,
  orientation: 'horizontal' | 'vertical' = 'vertical'
) {
  const activeIndexRef = useRef(0);
  const enabledItems = items.filter(item => !item.disabled);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    const { key } = event;
    
    switch (key) {
      case KEYBOARD_KEYS.ENTER:
      case KEYBOARD_KEYS.SPACE:
        if (enabledItems[activeIndexRef.current]) {
          onSelect(enabledItems[activeIndexRef.current].id);
          event.preventDefault();
        }
        break;
        
      case orientation === 'vertical' ? KEYBOARD_KEYS.ARROW_DOWN : KEYBOARD_KEYS.ARROW_RIGHT:
        activeIndexRef.current = (activeIndexRef.current + 1) % enabledItems.length;
        event.preventDefault();
        break;
        
      case orientation === 'vertical' ? KEYBOARD_KEYS.ARROW_UP : KEYBOARD_KEYS.ARROW_LEFT:
        activeIndexRef.current = activeIndexRef.current === 0 
          ? enabledItems.length - 1 
          : activeIndexRef.current - 1;
        event.preventDefault();
        break;
        
      case KEYBOARD_KEYS.HOME:
        activeIndexRef.current = 0;
        event.preventDefault();
        break;
        
      case KEYBOARD_KEYS.END:
        activeIndexRef.current = enabledItems.length - 1;
        event.preventDefault();
        break;
    }
  }, [enabledItems, onSelect, orientation]);

  return {
    activeIndex: activeIndexRef.current,
    handleKeyDown,
    setActiveIndex: (index: number) => {
      activeIndexRef.current = Math.max(0, Math.min(index, enabledItems.length - 1));
    },
  };
}

// Skip link component for keyboard navigation
export function useSkipLink(targetId: string) {
  const skipToContent = useCallback(() => {
    const target = document.getElementById(targetId);
    if (target) {
      target.focus();
      target.scrollIntoView({ behavior: 'smooth' });
    }
  }, [targetId]);

  return { skipToContent };
}

// Announce to screen readers
export function announceToScreenReader(message: string, priority: 'polite' | 'assertive' = 'polite') {
  const announcement = document.createElement('div');
  announcement.setAttribute('aria-live', priority);
  announcement.setAttribute('aria-atomic', 'true');
  announcement.className = 'sr-only';
  announcement.textContent = message;
  
  document.body.appendChild(announcement);
  
  setTimeout(() => {
    document.body.removeChild(announcement);
  }, 1000);
}

// Reduce motion preference
export function useReducedMotion() {
  const prefersReducedMotion = useCallback(() => {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  return prefersReducedMotion();
}

// Color contrast utilities
export function meetsContrastRatio(foreground: string, background: string, level: 'AA' | 'AAA' = 'AA'): boolean {
  // This is a simplified version - in production, you'd use a proper color contrast library
  const requiredRatio = level === 'AA' ? 4.5 : 7;
  // Implementation would calculate actual contrast ratio
  return true; // Placeholder
}

// ARIA attributes helpers
export const ariaAttributes = {
  // Button states
  button: (pressed?: boolean, expanded?: boolean) => ({
    role: 'button',
    'aria-pressed': pressed !== undefined ? pressed : undefined,
    'aria-expanded': expanded !== undefined ? expanded : undefined,
    tabIndex: 0,
  }),
  
  // Menu attributes
  menu: (labelledBy?: string) => ({
    role: 'menu',
    'aria-labelledby': labelledBy,
  }),
  
  menuItem: (hasPopup?: boolean) => ({
    role: 'menuitem',
    'aria-haspopup': hasPopup,
    tabIndex: -1,
  }),
  
  // Dialog attributes
  dialog: (labelledBy?: string, describedBy?: string) => ({
    role: 'dialog',
    'aria-modal': true,
    'aria-labelledby': labelledBy,
    'aria-describedby': describedBy,
  }),
  
  // Form attributes
  textbox: (invalid?: boolean, describedBy?: string) => ({
    role: 'textbox',
    'aria-invalid': invalid,
    'aria-describedby': describedBy,
  }),
  
  // List attributes
  listbox: (multiselectable?: boolean) => ({
    role: 'listbox',
    'aria-multiselectable': multiselectable,
  }),
  
  option: (selected?: boolean, disabled?: boolean) => ({
    role: 'option',
    'aria-selected': selected,
    'aria-disabled': disabled,
  }),
  
  // Tab attributes
  tabList: () => ({
    role: 'tablist',
  }),
  
  tab: (selected?: boolean, controls?: string) => ({
    role: 'tab',
    'aria-selected': selected,
    'aria-controls': controls,
    tabIndex: selected ? 0 : -1,
  }),
  
  tabPanel: (labelledBy?: string) => ({
    role: 'tabpanel',
    'aria-labelledby': labelledBy,
    tabIndex: 0,
  }),
};

// Landmark roles for better navigation
export const landmarkRoles = {
  main: 'main',
  navigation: 'navigation',
  complementary: 'complementary',
  contentinfo: 'contentinfo',
  banner: 'banner',
  search: 'search',
  form: 'form',
  region: 'region',
};

// Screen reader only text utility
export function ScreenReaderOnly({ children }: { children: React.ReactNode }) {
  return React.createElement('span', { className: 'sr-only' }, children);
}

// Focus visible utility hook
export function useFocusVisible() {
  const [focusVisible, setFocusVisible] = useState(false);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === KEYBOARD_KEYS.TAB) {
        setFocusVisible(true);
      }
    }

    function handleMouseDown() {
      setFocusVisible(false);
    }

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleMouseDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, []);

  return focusVisible;
}

// High contrast mode detection
export function useHighContrastMode() {
  const [highContrast, setHighContrast] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-contrast: high)');
    
    const handleChange = (event: MediaQueryListEvent) => {
      setHighContrast(event.matches);
    };

    setHighContrast(mediaQuery.matches);
    mediaQuery.addEventListener('change', handleChange);

    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, []);

  return highContrast;
}

// Toast announcement for screen readers
export function useToastAnnouncement() {
  const announceToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const priority = type === 'error' ? 'assertive' : 'polite';
    announceToScreenReader(`${type}: ${message}`, priority);
  }, []);

  return { announceToast };
}