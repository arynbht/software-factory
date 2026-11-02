/// <reference types="vite/client" />
import type { FactoryApi } from "../preload";

declare global {
  interface Window {
    /** The allow-listed bridge exposed by the preload (see src/preload). */
    factory: FactoryApi;
  }
}
