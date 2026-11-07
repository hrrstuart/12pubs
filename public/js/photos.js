// Profile photos stay on the phone they were added on. They're never sent to the server.
// They're shrunk to a small square JPEG and kept in localStorage for that night's room.
const key = (code, id) => `12pubs-photo-${code}-${id}`;
const mem = new Map(); // fallback when storage is blocked

export function getPhoto(code, id) {
  if (!code || !id) return null;
  if (mem.has(key(code, id))) return mem.get(key(code, id));
  try { return localStorage.getItem(key(code, id)); } catch { return null; }
}
export function setPhoto(code, id, dataUrl) {
  mem.set(key(code, id), dataUrl);
  try { localStorage.setItem(key(code, id), dataUrl); } catch { /* full or blocked: keep it for this visit */ }
}
export function removePhoto(code, id) {
  mem.delete(key(code, id));
  try { localStorage.removeItem(key(code, id)); } catch { /* ignore */ }
}
// Forget photos from rooms other than the current one (they're only for one night)
export function prunePhotos(keepCode) {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith("12pubs-photo-") && !k.startsWith(`12pubs-photo-${keepCode}-`)) localStorage.removeItem(k);
    }
  } catch { /* ignore */ }
}

// Crop to a centred square and shrink, so a 12MP phone photo becomes ~20 KB
export function fileToAvatar(file, size = 320) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) { reject(new Error("That's not a photo")); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(img.naturalWidth, img.naturalHeight);
      const c = document.createElement("canvas"); c.width = c.height = size;
      c.getContext("2d").drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Couldn't read that photo")); };
    img.src = url;
  });
}
