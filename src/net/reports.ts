import type { Backend } from './backend';
import { SERVER_TS } from './db';

export type ReportReason = 'abuse' | 'cheat' | 'name' | 'other';
export const REPORT_REASONS: ReportReason[] = ['abuse', 'cheat', 'name', 'other'];

/** File a report about a player. Reports are write-only for clients (review them in the console). */
export async function reportPlayer(be: Backend, by: string, target: string, reason: ReportReason, room?: string) {
  const id = be.db.pushKey('reports');
  await be.db.set(`reports/${id}`, { by, target, reason, room: room ?? '', at: SERVER_TS });
}
