import fs from 'node:fs';
import path from 'node:path';

/** A small JSON file with atomic writes and validation on read. */
export class JsonFile<T> {
  constructor(
    private readonly file: string,
    private readonly sanitize: (raw: unknown) => T,
  ) {}

  read(): T {
    try {
      return this.sanitize(JSON.parse(fs.readFileSync(this.file, 'utf8')));
    } catch {
      return this.sanitize(undefined);
    }
  }

  write(value: T): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
      fs.renameSync(tmp, this.file); // atomic: a crash never leaves half a file
    } catch (err) {
      // Some antivirus tools briefly lock files on Windows; fall back to a direct write.
      try {
        fs.writeFileSync(this.file, JSON.stringify(value, null, 2));
      } catch {
        console.error('[AquaMate] Could not save', this.file, err);
      }
    }
  }
}

interface DailyData {
  date: string; // local YYYY-MM-DD
  glasses: number;
  reminders: number; // reminders shown today
}

export function localDate(t = Date.now()): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function sanitizeDaily(v: unknown): DailyData {
  const r = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  const n = (x: unknown) => (typeof x === 'number' && Number.isInteger(x) && x >= 0 && x < 1000 ? x : 0);
  return { date: typeof r.date === 'string' ? r.date : '', glasses: n(r.glasses), reminders: n(r.reminders) };
}

/**
 * Today's glass count only (no history): it resets at local midnight.
 */
export class DailyLog {
  private data: DailyData;
  private readonly file: JsonFile<DailyData>;

  constructor(filePath: string) {
    this.file = new JsonFile(filePath, sanitizeDaily);
    this.data = this.file.read();
  }

  private today(now: number): DailyData {
    const date = localDate(now);
    return this.data.date === date ? this.data : { date, glasses: 0, reminders: 0 };
  }

  glassesToday(now = Date.now()): number {
    return this.today(now).glasses;
  }

  remindersToday(now = Date.now()): number {
    return this.today(now).reminders;
  }

  addGlass(now = Date.now()): number {
    const t = this.today(now);
    this.data = { ...t, glasses: t.glasses + 1 };
    this.file.write(this.data);
    return this.data.glasses;
  }

  reminderShown(now = Date.now()): void {
    const t = this.today(now);
    this.data = { ...t, reminders: t.reminders + 1 };
    this.file.write(this.data);
  }
}
