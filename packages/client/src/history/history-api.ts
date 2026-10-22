// History of graded Practice sets that left the Canvas (ADR-0004 auto-tidy).
import { apiPaths, type HistoryResponse } from "@prepare-to-interview/shared";
import { request } from "../api.ts";

export const fetchHistory = () => request<HistoryResponse>(apiPaths.history);
