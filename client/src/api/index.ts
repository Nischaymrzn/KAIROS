/**
 * API MODULE — public surface. Import from "api", never from deep paths.
 * Everything the client knows about the backend lives behind this boundary.
 */
export * from "./endpoints";
export * from "./types";
export { ApiError, isAbort } from "./http";
export {
  getApiBase, discoverApiBase, onApiBaseChange, invalidateApiBase, HEALTH_POLL_MS,
} from "./config";
