import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "conway_session_history";
const MAX_SESSIONS = 50;

export interface DischargeSession {
  id: string;
  startLevel: number;       // % when discharge session started
  endLevel: number;         // % when session ended (plugged in or app closed)
  startTime: number;        // Unix ms
  endTime: number;          // Unix ms
  durationMinutes: number;  // rounded minutes
  avgDrainRatePerMin: number; // average %/min over the session
}

export async function loadSessions(): Promise<DischargeSession[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as DischargeSession[];
  } catch {
    return [];
  }
}

export async function saveSession(session: DischargeSession): Promise<void> {
  try {
    const existing = await loadSessions();
    // Prepend newest first, cap at MAX_SESSIONS
    const updated = [session, ...existing].slice(0, MAX_SESSIONS);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // Silently fail — history is non-critical
  }
}

export async function clearSessions(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}

export function formatSessionDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatSessionTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
