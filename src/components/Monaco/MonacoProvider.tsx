import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import { ReactNode, useEffect, useRef } from "react";
import { useTheme } from "../../hooks/useTheme";
import { themeToMonacoTheme } from "../../themes/monacoAdapter";
import "./monaco.css";

// Activate built-in Twig language (Monarch grammar for {{ }}, {% %}, {# #}, etc.)
import "monaco-editor/esm/vs/basic-languages/twig/twig.contribution.js";

// Configure Monaco to use the local npm package instead of CDN
// This ensures the app works offline (local-first)
loader.config({ monaco });

/** Name used for the dynamically registered Monaco theme */
export const MONACO_THEME_NAME = "ultra-active-theme";

interface MonacoProviderProps {
  children: ReactNode;
}

export function MonacoProvider({ children }: MonacoProviderProps) {
  const { theme } = useTheme();
  const monacoRef = useRef<typeof monaco | null>(null);

  // Pre-load Monaco and register initial theme
  useEffect(() => {
    loader.init().then((monacoInstance) => {
      monacoRef.current = monacoInstance;
      const monacoTheme = themeToMonacoTheme(theme);
      monacoInstance.editor.defineTheme(MONACO_THEME_NAME, monacoTheme);
      monacoInstance.editor.setTheme(MONACO_THEME_NAME);
    }).catch(console.error);
    // Only run on mount — theme changes handled by the effect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-register and apply Monaco theme whenever the app theme changes
  useEffect(() => {
    const monacoInstance = monacoRef.current;
    if (!monacoInstance) return;
    const monacoTheme = themeToMonacoTheme(theme);
    monacoInstance.editor.defineTheme(MONACO_THEME_NAME, monacoTheme);
    monacoInstance.editor.setTheme(MONACO_THEME_NAME);
  }, [theme]);

  return <>{children}</>;
}

export default MonacoProvider;
