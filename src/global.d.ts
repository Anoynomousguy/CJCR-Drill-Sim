export interface DesktopBridge {
  isDesktop: true;
  platform: () => Promise<string>;
  savePlan: (payload: { json: string; path?: string | null }) => Promise<{
    canceled: boolean;
    path?: string;
  }>;
  openPlan: () => Promise<{ canceled: boolean; path?: string; json?: string }>;
  onMenu: (callback: (command: string) => void) => () => void;
}

declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}

export {};
