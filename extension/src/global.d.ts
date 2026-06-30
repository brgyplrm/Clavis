declare const chrome: any;
declare const browser: any;
declare function importScripts(...urls: string[]): void;
declare function ensureConnected(): Promise<boolean>;
declare function sendWsMessage(payload: any): Promise<any>;
declare function fetchTokenAndConnect(): void;
declare function logToTab(msg: string, ...args: any[]): void;
