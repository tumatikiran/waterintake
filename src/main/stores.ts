import fs from 'node:fs';
import path from 'node:path';
import { dayOf, sanitizeDaily, withGlass, withReminderShown, type DailyData } from '../shared/daily';

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

  glassesToday(now = Date.now()): number {
    return dayOf(this.data, now).glasses;
  }

  remindersToday(now = Date.now()): number {
    return dayOf(this.data, now).reminders;
  }

  addGlass(now = Date.now()): number {
    this.data = withGlass(this.data, now);
    this.file.write(this.data);
    return this.data.glasses;
  }

  reminderShown(now = Date.now()): void {
    this.data = withReminderShown(this.data, now);
    this.file.write(this.data);
  }
}
