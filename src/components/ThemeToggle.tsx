import React from 'react';
// import { Sun, Moon } from 'lucide-react';
import { useTheme } from '../lib/theme';

export function ThemeToggle() {
  const { toggleTheme } = useTheme();

  return (
    <button
      id="theme-toggle"
      onClick={toggleTheme}
      className="hidden"
      aria-label="Toggle theme"
    />
  );
}