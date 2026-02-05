import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import { ReactNode, useEffect } from "react";
import { kanagawaWaveTheme, KANAGAWA_THEME_NAME } from "./kanagawaTheme";
import "./monaco.css";

// Configure Monaco to use the local npm package instead of CDN
// This ensures the app works offline (local-first)
loader.config({ monaco });

interface MonacoProviderProps {
  children: ReactNode;
}

export function MonacoProvider({ children }: MonacoProviderProps) {
  useEffect(() => {
    // Pre-load Monaco and register theme
    loader.init().then((monacoInstance) => {
      // Register Kanagawa Wave theme
      monacoInstance.editor.defineTheme(KANAGAWA_THEME_NAME, kanagawaWaveTheme);
    }).catch(console.error);
  }, []);

  return <>{children}</>;
}

export default MonacoProvider;
