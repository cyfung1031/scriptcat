/* ---------- Helper functions ---------- */

/** Convert a Blob/File to Uint8Array */
export const blobToUint8Array = async (blob: Blob): Promise<Uint8Array<ArrayBuffer>> => {
  if (typeof blob?.arrayBuffer === "function") return new Uint8Array(await blob.arrayBuffer());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(new Uint8Array(reader.result as ArrayBuffer));
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(blob);
  });
};

// Helper to join Uint8Array chunks
export function concatUint8(chunks: Uint8Array<ArrayBufferLike>[]): Uint8Array<ArrayBuffer> {
  const totalLen = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(totalLen);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** Base64 -> Uint8Array (browser-safe) */
export function base64ToUint8(b64: string): Uint8Array<ArrayBuffer> {
  if (typeof (Uint8Array as any).fromBase64 === "function") {
    // JS 2025
    return (Uint8Array as any).fromBase64(b64) as Uint8Array<ArrayBuffer>;
  } else if (typeof Buffer !== "undefined" && typeof Buffer.from === "function") {
    // Node.js
    return Uint8Array.from(Buffer.from(b64, "base64"));
  } else {
    // Fallback
    const bin = atob(b64);
    const ab = new ArrayBuffer(bin.length);
    const out = new Uint8Array<ArrayBuffer>(ab); // <- Uint8Array<ArrayBuffer>
    for (let i = 0, l = bin.length; i < l; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
}

export function uint8ToBase64(uint8arr: Uint8Array<ArrayBufferLike>): string {
  if (typeof (uint8arr as any).toBase64 === "function") {
    // JS 2025
    return (uint8arr as any).toBase64() as string;
  } else if (typeof Buffer !== "undefined" && typeof Buffer.from === "function") {
    // Node.js
    return Buffer.from(uint8arr).toString("base64") as string;
  } else {
    // Fallback
    let binary = "";
    let i = 0;
    while (uint8arr.length - i > 65535) {
      binary += String.fromCharCode(...uint8arr.slice(i, i + 65535));
      i += 65535;
    }
    binary += String.fromCharCode(...(i ? uint8arr.slice(i) : uint8arr));
    return btoa(binary) as string;
  }
}

// Split Uint8Array (or ArrayBuffer) into 2MB chunks as Uint8Array views
export function chunkUint8(src: Uint8Array | ArrayBuffer, chunkSize = 2 * 1024 * 1024): Uint8Array<ArrayBufferLike>[] {
  const u8 = src instanceof Uint8Array ? src : new Uint8Array(src);
  const chunks: Uint8Array<ArrayBufferLike>[] = [];
  for (let i = 0, l = u8.length; i < l; i += chunkSize) {
    chunks.push(u8.subarray(i, Math.min(i + chunkSize, u8.length)));
  }
  return chunks; // array of Uint8Array views
}
