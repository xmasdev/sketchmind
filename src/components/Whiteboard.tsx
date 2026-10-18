"use client";

import "@excalidraw/excalidraw/index.css";

import {
  CaptureUpdateAction,
  Excalidraw,
  MainMenu,
  WelcomeScreen,
  convertToExcalidrawElements,
  exportToBlob,
} from "@excalidraw/excalidraw";
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";
import { useEffect, useMemo, useRef } from "react";

import { sceneToText, type SceneElement } from "@/lib/sceneToText";
import type { BoardApi } from "@/lib/types";

const STORAGE_KEY = "sketchmind:scene:v1";

type Theme = "light" | "dark";

interface Props {
  onReady: (api: BoardApi) => void;
  onThemeChange?: (theme: Theme) => void;
}

function loadScene(): ExcalidrawInitialDataState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    return {
      elements: saved.elements ?? [],
      files: saved.files ?? {},
      appState: { ...saved.appState, collaborators: new Map() },
      // reopen where the user left off; fall back to centring the content
      scrollToContent: typeof saved.appState?.scrollX !== "number",
    };
  } catch {
    return null;
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export default function Whiteboard({ onReady, onThemeChange }: Props) {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const themeRef = useRef<Theme | null>(null);
  const initialData = useMemo(() => loadScene(), []);

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  const handleApi = (api: ExcalidrawImperativeAPI) => {
    apiRef.current = api;

    const boardApi: BoardApi = {
      describe: () =>
        sceneToText(api.getSceneElements() as unknown as readonly SceneElement[]),

      snapshot: async () => {
        const elements = api.getSceneElements();
        if (elements.length === 0) return null;
        const blob = await exportToBlob({
          elements,
          appState: { ...api.getAppState(), exportBackground: true },
          files: api.getFiles(),
          mimeType: "image/jpeg",
          quality: 0.85,
          maxWidthOrHeight: 1280,
          exportPadding: 24,
        });
        return blobToDataUrl(blob);
      },

      addMermaid: async (definition: string) => {
        // mermaid is heavy; only load it when the AI actually draws something
        const { parseMermaidToExcalidraw } = await import("@excalidraw/mermaid-to-excalidraw");
        const { elements: skeleton, files } = await parseMermaidToExcalidraw(definition, {
          themeVariables: { fontSize: "18px" },
        });
        const created = convertToExcalidrawElements(skeleton, { regenerateIds: true });
        if (created.length === 0) throw new Error("The diagram came out empty.");

        // place the new diagram to the right of whatever is already on the board
        const existing = api.getSceneElements();
        let dx = 0;
        let dy = 0;
        if (existing.length) {
          const right = Math.max(...existing.map((e) => e.x + e.width));
          const top = Math.min(...existing.map((e) => e.y));
          const newLeft = Math.min(...created.map((e) => e.x));
          const newTop = Math.min(...created.map((e) => e.y));
          dx = right + 160 - newLeft;
          dy = top - newTop;
        }
        const placed = created.map((e) => ({ ...e, x: e.x + dx, y: e.y + dy }));

        if (files) api.addFiles(Object.values(files));
        api.updateScene({
          elements: [...existing, ...placed],
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
        api.scrollToContent(placed, { fitToContent: true, animate: true, duration: 400 });
      },

      clear: () => {
        api.resetScene();
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {}
      },
    };

    onReady(boardApi);
  };

  const handleChange = (
    elements: readonly unknown[],
    appState: AppState,
    files: BinaryFiles,
  ) => {
    if (appState.theme !== themeRef.current) {
      themeRef.current = appState.theme as Theme;
      onThemeChange?.(appState.theme as Theme);
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try {
        const live = (elements as { isDeleted?: boolean }[]).filter((e) => !e.isDeleted);
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            elements: live,
            files,
            appState: {
              theme: appState.theme,
              viewBackgroundColor: appState.viewBackgroundColor,
              gridModeEnabled: appState.gridModeEnabled,
              scrollX: appState.scrollX,
              scrollY: appState.scrollY,
              zoom: appState.zoom,
            },
          }),
        );
      } catch {
        // storage full or unavailable — the board still works, it just won't persist
      }
    }, 400);
  };

  return (
    <div className="absolute inset-0">
      <Excalidraw
        excalidrawAPI={handleApi}
        initialData={initialData}
        onChange={handleChange}
        UIOptions={{ canvasActions: { toggleTheme: true } }}
      >
        <MainMenu>
          <MainMenu.DefaultItems.LoadScene />
          <MainMenu.DefaultItems.SaveToActiveFile />
          <MainMenu.DefaultItems.Export />
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.DefaultItems.ClearCanvas />
          <MainMenu.Separator />
          <MainMenu.DefaultItems.ToggleTheme />
          <MainMenu.DefaultItems.ChangeCanvasBackground />
        </MainMenu>
        <WelcomeScreen>
          <WelcomeScreen.Hints.MenuHint />
          <WelcomeScreen.Hints.ToolbarHint />
          <WelcomeScreen.Center>
            <WelcomeScreen.Center.Heading>
              Sketch an idea, then talk it through with the AI.
            </WelcomeScreen.Center.Heading>
            <WelcomeScreen.Center.Menu>
              <WelcomeScreen.Center.MenuItemLoadScene />
              <WelcomeScreen.Center.MenuItemHelp />
            </WelcomeScreen.Center.Menu>
          </WelcomeScreen.Center>
        </WelcomeScreen>
      </Excalidraw>
    </div>
  );
}
