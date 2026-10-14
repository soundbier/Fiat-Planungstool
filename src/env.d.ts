// Typen für Vite-Spezifika (nur für die Typprüfung)
interface ImportMetaEnv { readonly [key: string]: string | undefined }
interface ImportMeta { readonly env: ImportMetaEnv }
declare module '*.css';
declare module 'virtual:pwa-register' {
  export function registerSW(o?: { onNeedRefresh?: () => void, onOfflineReady?: () => void, onRegisterError?: (e: unknown) => void }): (reload?: boolean) => Promise<void>;
}
