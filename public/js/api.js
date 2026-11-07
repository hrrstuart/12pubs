// Talking to the server. Every call resolves with the server's reply or rejects with a readable message.
/* global io */
export const socket = io();

// Installable app (PWA). Service workers need https or localhost.
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

const KEY = "12pubs-session";
export function loadSession() { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } }
export function saveSession(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ } }
export function clearSession() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }

export function call(event, payload = {}) {
  return new Promise((resolve, reject) => {
    if (!socket.connected) { reject(new Error("No connection right now. Check your signal.")); return; }
    socket.timeout(8000).emit(event, payload, (err, r) => {
      if (err) reject(new Error("The server didn't answer. Try again."));
      else if (!r || !r.ok) reject(new Error((r && r.error) || "Something went wrong"));
      else resolve(r);
    });
  });
}

export const host = (action, args = {}) => call("host", { action, args });

export async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("Couldn't load " + url);
  return r.json();
}

// Saving the recap image. On the real site this is a normal browser download.
export const canDownload = async () => true;
export async function saveFile(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return true;
}
