// Accounts, bookmarks (persist between runs) and the leaderboard. Uses Node's built-in SQLite
// (node:sqlite) so there is no native dependency to package.
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface UserRow { id: number; name: string }

export class Db {
  private db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        salt TEXT NOT NULL,
        hash TEXT NOT NULL,
        created INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        created INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS bookmarks (
        user_id INTEGER NOT NULL REFERENCES users(id),
        kind TEXT NOT NULL,
        key TEXT NOT NULL,
        at INTEGER NOT NULL,
        PRIMARY KEY (user_id, kind, key)
      );
      CREATE TABLE IF NOT EXISTS scores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        name TEXT NOT NULL,
        floor INTEGER NOT NULL,
        bits INTEGER NOT NULL,
        seed TEXT NOT NULL,
        players INTEGER NOT NULL,
        at INTEGER NOT NULL
      );
    `);
  }

  private hash(password: string, salt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      scrypt(password, salt, 32, (err, key) => (err ? reject(err) : resolve(key.toString('hex'))));
    });
  }

  private newSession(userId: number): string {
    const token = randomBytes(24).toString('hex');
    this.db.prepare('INSERT INTO sessions (token, user_id, created) VALUES (?, ?, ?)').run(token, userId, Date.now());
    return token;
  }

  async register(name: string, password: string): Promise<{ token: string; user: UserRow }> {
    name = name.trim();
    if (!/^[\w .-]{2,20}$/.test(name)) throw new Error('Name must be 2-20 letters, digits, space, _ . -');
    if (password.length < 6 || password.length > 200) throw new Error('Password must be at least 6 characters');
    const exists = this.db.prepare('SELECT id FROM users WHERE name = ?').get(name);
    if (exists) throw new Error('That name is taken');
    const salt = randomBytes(16).toString('hex');
    const hash = await this.hash(password, salt);
    const res = this.db.prepare('INSERT INTO users (name, salt, hash, created) VALUES (?, ?, ?, ?)').run(name, salt, hash, Date.now());
    const id = Number(res.lastInsertRowid);
    return { token: this.newSession(id), user: { id, name } };
  }

  async login(name: string, password: string): Promise<{ token: string; user: UserRow }> {
    const row = this.db.prepare('SELECT id, name, salt, hash FROM users WHERE name = ?').get(name.trim()) as
      | { id: number; name: string; salt: string; hash: string } | undefined;
    if (!row) throw new Error('Wrong name or password');
    const h = await this.hash(password, row.salt);
    const a = Buffer.from(h, 'hex'), b = Buffer.from(row.hash, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('Wrong name or password');
    return { token: this.newSession(row.id), user: { id: row.id, name: row.name } };
  }

  userForToken(token: string | undefined): UserRow | null {
    if (!token || typeof token !== 'string' || token.length > 100) return null;
    const row = this.db.prepare(
      'SELECT users.id AS id, users.name AS name FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token = ?',
    ).get(token) as UserRow | undefined;
    return row ?? null;
  }

  addBookmark(userId: number, kind: string, key: string): void {
    this.db.prepare('INSERT OR IGNORE INTO bookmarks (user_id, kind, key, at) VALUES (?, ?, ?, ?)').run(userId, kind, key, Date.now());
  }

  bookmarks(userId: number): { kind: string; key: string }[] {
    return this.db.prepare('SELECT kind, key FROM bookmarks WHERE user_id = ? ORDER BY at').all(userId) as { kind: string; key: string }[];
  }

  addScore(userId: number | null, name: string, floor: number, bits: number, seed: string, players: number): void {
    this.db.prepare('INSERT INTO scores (user_id, name, floor, bits, seed, players, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(userId, name, floor, bits, seed, players, Date.now());
  }

  leaderboard(limit = 20): { name: string; floor: number; bits: number; seed: string; players: number }[] {
    return this.db.prepare('SELECT name, floor, bits, seed, players FROM scores ORDER BY floor DESC, bits DESC LIMIT ?').all(limit) as
      { name: string; floor: number; bits: number; seed: string; players: number }[];
  }
}

export function fingerprint(s: string): string {
  return createHash('sha1').update(s).digest('hex').slice(0, 8);
}
