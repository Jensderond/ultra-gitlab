import { loader } from "@monaco-editor/react";
import { ReactNode, useEffect } from "react";
import { kanagawaWaveTheme, KANAGAWA_THEME_NAME } from "./kanagawaTheme";
import "./monaco.css";

interface MonacoProviderProps {
  children: ReactNode;
}

export function MonacoProvider({ children }: MonacoProviderProps) {
  useEffect(() => {
    // Configure Monaco loader
    loader.config({
      paths: {
        vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.55.1/min/vs",
      },
    });

    // Pre-load Monaco and register theme
    loader.init().then((monaco) => {
      // Register Kanagawa Wave theme
      monaco.editor.defineTheme(KANAGAWA_THEME_NAME, kanagawaWaveTheme);
    }).catch(console.error);
  }, []);

  return <>{children}</>;
}

export default MonacoProvider;
