/**
 * Type declarations for stremio-addon-sdk
 */

declare module "stremio-addon-sdk" {
  export interface ManifestObject {
    id: string;
    version: string;
    name: string;
    description: string;
    resources: string[];
    types: string[];
    catalogs: unknown[];
    idPrefixes?: string[];
    background?: string;
    logo?: string;
    behaviorHints?: {
      configurable?: boolean;
      configurationRequired?: boolean;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  }

  export interface StreamRequest {
    type: string;
    id: string;
  }

  export interface StreamResponse {
    streams: unknown[];
  }

  export class addonBuilder {
    constructor(manifest: ManifestObject);
    defineStreamHandler(handler: (args: StreamRequest) => Promise<StreamResponse> | StreamResponse): void;
    getInterface(): unknown;
  }

  export function serveHTTP(addonInterface: unknown, options: { port: number }): unknown;
}

