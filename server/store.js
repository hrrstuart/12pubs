// Rooms live in memory and are snapshotted to a JSON file so a restart
// doesn't end anyone's night. Rooms only need to last one night.
import fs from "node:fs";
import path from "node:path";
import { createRoomState } from "./room.js";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L
const MAX_AGE = 24 * 60 * 60 * 1000;

export class RoomStore {
  constructor(file) {
    this.file = file;
    this.rooms = new Map();
    this.saveTimer = null;
    this.load();
    setInterval(() => this.sweep(), 10 * 60 * 1000).unref();
  }
  load() {
    if (!this.file) return;
    try {
      const data = JSON.parse(fs.readFileSync(this.file, "utf8"));
      for (const s of data.rooms || []) this.rooms.set(s.code, s);
      this.sweep();
      console.log(`Loaded ${this.rooms.size} room(s) from ${this.file}`);
    } catch (e) {
      if (e.code !== "ENOENT") console.error("Couldn't read saved rooms:", e.message);
    }
  }
  save() {
    if (!this.file || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        const tmp = this.file + ".tmp";
        fs.writeFileSync(tmp, JSON.stringify({ rooms: [...this.rooms.values()] }));
        fs.renameSync(tmp, this.file); // atomic replace
      } catch (e) { console.error("Couldn't save rooms:", e.message); }
    }, 1000);
  }
  code() {
    for (let tries = 0; tries < 1000; tries++) {
      const c = Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");
      if (!this.rooms.has(c)) return c;
    }
    throw new Error("Out of room codes");
  }
  create(input) {
    const state = createRoomState(this.code(), input);
    this.rooms.set(state.code, state);
    this.save();
    return state;
  }
  get(code) {
    const s = this.rooms.get(String(code || "").toUpperCase().trim());
    if (s && s.expiresAt && Date.now() > s.expiresAt) { this.rooms.delete(s.code); this.save(); return undefined; }
    return s;
  }
  touch(state) { state.updatedAt = Date.now(); this.save(); }
  sweep() {
    // Finished nights go when their recap expires; unfinished ones 24h after anyone last did anything
    const now = Date.now(), cutoff = now - MAX_AGE;
    let removed = 0;
    for (const [c, s] of this.rooms) if (s.expiresAt ? now > s.expiresAt : s.updatedAt < cutoff) { this.rooms.delete(c); removed++; }
    if (removed) this.save();
  }
}
