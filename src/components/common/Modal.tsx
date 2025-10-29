import React, { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'object',
  'embed',
  '[contenteditable]',
  '[tabindex]:not([tabindex="-1"])'
].join(', ');

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  titleId: string;
  children: React.ReactNode;
  initialFocusRef?: React.RefObject<HTMLElement>;
  describedById?: string;
  overlayClassName?: string;
  panelClassName?: string;
}

const isElementVisible = (element: HTMLElement) => {
  if (element.hidden) {
    return false;
  }

  const ariaHidden = element.getAttribute('aria-hidden');
  if (ariaHidden && ariaHidden.toLowerCase() === 'true') {
    return false;
  }

  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden';
};

export function Modal({
  isOpen,
  onClose,
  titleId,
  children,
  initialFocusRef,
  describedById,
  overlayClassName,
  panelClassName
}: ModalProps) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const previousActiveElement = document.activeElement as HTMLElement | null;
    const contentElement = contentRef.current;

    if (!contentElement) {
      return;
    }

    const getFocusableElements = () =>
      Array.from(contentElement.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (element) => !element.hasAttribute('disabled') && isElementVisible(element)
      );

    const focusInitialElement = () => {
      const fallback = contentElement;
      const focusTarget = initialFocusRef?.current ?? getFocusableElements()[0] ?? fallback;
      focusTarget?.focus();
    };

    focusInitialElement();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const focusableElements = getFocusableElements();

      if (focusableElements.length === 0) {
        event.preventDefault();
        contentElement.focus();
        return;
      }

      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement as HTMLElement | null;

      if (event.shiftKey) {
        if (activeElement === first || !contentElement.contains(activeElement)) {
          event.preventDefault();
          last.focus();
        }
        return;
      }

      if (activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const enforceFocus = (event: FocusEvent) => {
      if (!contentElement.contains(event.target as Node)) {
        event.stopPropagation();
        focusInitialElement();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('focus', enforceFocus, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('focus', enforceFocus, true);
      previousActiveElement?.focus();
    };
  }, [initialFocusRef, isOpen]);

  if (!isOpen) {
    return null;
  }

  const handleOverlayClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target === overlayRef.current) {
      onCloseRef.current();
    }
  };

  return (
    <div
      ref={overlayRef}
      className={
        overlayClassName ??
        'fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50'
      }
      role="presentation"
      onMouseDown={handleOverlayClick}
    >
      <div
        ref={contentRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedById}
        tabIndex={-1}
        className={panelClassName ?? 'w-full max-w-md rounded-lg bg-white p-6 shadow-xl'}
      >
        {children}
      </div>
    </div>
  );
}
