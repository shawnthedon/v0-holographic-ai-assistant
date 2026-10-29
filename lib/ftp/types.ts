/**
 * FTP target shapes shared by the browser and the route handler.
 *
 * The password is deliberately *not* part of any persisted record: it is held
 * for the lifetime of the tab (sessionStorage, cleared when the tab closes) and
 * never written to IndexedDB, logs, telemetry or the sync queue.
 */

export interface FtpTarget {
  host: string;
  port: number;
  /** Explicit TLS (FTPS). Plain FTP is allowed but flagged. */
  secure: boolean;
  username: string;
  password: string;
  /** Remote directory, created if missing. */
  remoteDir: string;
}

/** What the UI may display and what the sync queue may persist. */
export type FtpPlan = Omit<FtpTarget, 'password'>;

export interface FtpUploadItem {
  name: string;
  /** base64 — JSON transport, so no multipart parsing in the route. */
  contentBase64: string;
  sizeBytes: number;
}

export interface FtpUploadResult {
  name: string;
  bytes: number;
  remotePath: string;
  sha256?: string;
}

export interface FtpError {
  code: string;
  message: string;
  fix: string;
}

export const FTP_DEFAULT_PORT = 21;
export const FTPS_DEFAULT_PORT = 990;
/** One upload request carries at most this much decoded payload. */
export const FTP_MAX_BATCH_BYTES = 24 * 1024 * 1024;
/** And at most this many files. */
export const FTP_MAX_FILES = 12;
