import { loader } from "@monaco-editor/react";
import { ReactNode, useEffect } from "react";

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

    // Pre-load Monaco in background
    loader.init().catch(console.error);
  }, []);

  return <>{children}</>;
}

export default MonacoProvider;
