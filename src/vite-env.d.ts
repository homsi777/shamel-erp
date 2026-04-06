/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RESTAURANT_MODULE_ENABLED?: string;
  readonly VITE_QR_MENU_PORT?: string;
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.png' {
  const src: string;
  export default src;
}

declare module 'leaflet/dist/images/marker-icon-2x.png' {
  const src: string;
  export default src;
}

declare module 'leaflet/dist/images/marker-icon.png' {
  const src: string;
  export default src;
}

declare module 'leaflet/dist/images/marker-shadow.png' {
  const src: string;
  export default src;
}
