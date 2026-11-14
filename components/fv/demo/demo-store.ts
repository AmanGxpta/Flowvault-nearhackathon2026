"use client";
// Demo Mode flows live only in this browser tab (sessionStorage): they're fictional, never reach the server, and a
// private window or cleared storage simply starts over. Listeners re-render when a flow changes.
const KEY = "fv-demo-flows-v1";
type Row = { id: string; kind: string; updatedAt: number; [k: string]: unknown };
const read = (): Row[] => { try { return JSON.parse(sessionStorage.getItem(KEY) ?? "[]") as Row[]; } catch { return []; } };
const write = (rows: Row[]) => { try { sessionStorage.setItem(KEY, JSON.stringify(rows.slice(0, 30))); } catch { /* storage blocked: the flow lives for this page only */ } window.dispatchEvent(new Event("fv:demo-flows")); };
const memory = new Map<string, Row>();
export function demoGet<T extends Row>(id: string): T | null { return (read().find(r => r.id === id) ?? memory.get(id) ?? null) as T | null; }
export function demoList<T extends Row>(kind: string): T[] { const rows = read(); return [...rows, ...[...memory.values()].filter(m => !rows.some(r => r.id === m.id))].filter(r => r.kind === kind).sort((a, b) => b.updatedAt - a.updatedAt) as T[]; }
export function demoPut<T extends Row>(row: T): T { row.updatedAt = Date.now(); memory.set(row.id, row); write([row, ...read().filter(r => r.id !== row.id)]); return row; }
export const demoId = () => "demo-" + crypto.randomUUID();
export const isDemoId = (id: string) => id.startsWith("demo-");
