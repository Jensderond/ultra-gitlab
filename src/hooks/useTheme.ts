/**
 * Theme hook - provides access to the current theme from ThemeContext.
 */

import { useContext } from 'react';
import { ThemeContext, type ThemeContextValue } from '../components/ThemeProvider';

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
}

export default useTheme;
