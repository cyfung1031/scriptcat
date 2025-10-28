import { base64ToUint8, uint8ToBase64 } from "./xhr_api";
import { getOPFSTemp, setOPFSTemp } from "./opfs";

export const typedArrayTypes = [
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
  Float32Array,
  Float64Array,
  BigInt64Array,
  BigUint64Array,
];

export const typedArrayTypesText = typedArrayTypes.map((e) => e.name);

// 由於Decode端總是service_worker/offscreen
// 假如當前Encode端環境沒有 URL.createObjectURL, 必定是 service_worker (page/content/offscreen 都有 URL.createObjectURL)
// Encode端環境沒有 URL.createObjectURL -> OPFS -> service_worker/offscreen 讀取 OPFS
// Encode端環境有 URL.createObjectURL -> URL.createObjectURL -> service_worker/offscreen 讀取 BlobURL
const innerToBlobUrl =
  typeof URL.createObjectURL === "function"
    ? (blob: Blob): string => {
        // 執行端：content/page/offscreen
        return URL.createObjectURL(blob);
      }
    : async (blob: Blob): Promise<string> => {
        // 執行端：service_worker
        const filename = await setOPFSTemp(blob);
        return filename;
      };
const innerFromBlobUrl = async (f: string): Promise<Blob> => {
  // 執行端：service_worker/offscreen
  if (f.length === 36) {
    // OPFS
    const file = await getOPFSTemp(f);
    if (!file) throw new Error("OPFS Temp File is missing");
    const blob = new Blob([file], { type: file.type }); // pure blob, zero-copy
    return blob;
  } else {
    const res = await fetch(f);
    const blob = await res.blob();
    return blob;
  }
};

export const dataDecode = (pData: any) => {
  let kData = undefined;
  if (!pData || !pData.type) {
    kData = undefined;
  } else {
    if (pData.type === "null") {
      kData = null;
    } else if (pData.type === "undefined") {
      kData = undefined;
    } else if (pData.type === "object") {
      kData = JSON.parse(pData.m);
    } else if (pData.type === "DataView") {
      const ubuf = base64ToUint8(pData.m);
      kData = new DataView(ubuf.buffer);
    } else if (pData.type === "ArrayBuffer") {
      const ubuf = base64ToUint8(pData.m);
      kData = ubuf.buffer;
    } else if (pData.type === "Blob") {
      const [blobUrl] = pData.m;
      kData = Promise.resolve(innerFromBlobUrl(blobUrl));
    } else if (pData.type === "File") {
      const [blobUrl, fileName, lastModified] = pData.m;
      kData = Promise.resolve(innerFromBlobUrl(blobUrl)).then((blob) => {
        if (blob instanceof File) return blob;
        const type = blob.type || "application/octet-stream";
        return new File([blob], fileName, { type, lastModified });
      });
    } else if (pData.type === "FormData") {
      const d = pData.m as GMSend.XHRFormData[];
      const fd = new FormData();
      kData = Promise.all(
        d.map(async (o) => {
          if (o.type === "text") fd.append(o.key, o.val);
          else if (o.type === "file") {
            const blob = await innerFromBlobUrl(o.val);
            let ret;
            if (o.filename) {
              const type = blob.type || "application/octet-stream";
              const lastModified = o.lastModified;
              ret = new File([blob], o.filename, { type, lastModified });
              fd.append(o.key, ret, o.filename);
            } else {
              ret = blob;
              fd.append(o.key, ret);
            }
          }
        })
      ).then(() => fd);
    } else if (pData.type === "URLSearchParams") {
      kData = new URLSearchParams(`${pData.m}`);
    } else {
      const idx = typedArrayTypesText.indexOf(pData.type);
      if (idx >= 0) {
        const ubuf = base64ToUint8(pData.m);
        const T = typedArrayTypes[idx];
        kData = ubuf instanceof T ? ubuf : new T(ubuf.buffer);
      } else {
        kData = pData.m;
      }
    }
  }
  return kData;
};

export const dataEncode = async (kData: any) => {
  if (kData?.then) {
    kData = await kData;
  }
  if (kData instanceof Document) {
    throw new Error("GM xhr data does not support Document");
  }
  // 处理数据
  let extData = {
    type: kData === undefined ? "undefined" : kData === null ? "null" : "undefined",
    m: null,
  } as {
    type: string;
    m: any;
  };
  if (kData instanceof ReadableStream) {
    kData = await new Response(kData).blob();
  }
  if (kData instanceof DataView) {
    const uint8Copy = new Uint8Array(kData.buffer, kData.byteOffset, kData.byteLength);
    extData = {
      type: "DataView",
      m: uint8ToBase64(uint8Copy),
    };
  } else if (kData instanceof URLSearchParams) {
    extData = {
      type: "URLSearchParams",
      m: `${kData}`,
    };
  } else if (kData instanceof FormData) {
    // 处理FormData
    // param.dataType = "FormData";
    // 处理FormData中的数据
    const data = (await Promise.all(
      [...kData.entries()].map(([key, val]) =>
        val instanceof File
          ? ({
              key,
              type: "file",
              val: innerToBlobUrl(val),
              filename: val.name,
              lastModified: val.lastModified,
            } as GMSend.XHRFormData)
          : ({
              key,
              type: "text",
              val,
            } as GMSend.XHRFormData)
      )
    )) as GMSend.XHRFormData[];
    // param.data = data;
    extData = {
      type: "FormData",
      m: data,
    };
  } else if (ArrayBuffer.isView(kData)) {
    if (kData instanceof Uint8Array) {
      extData = {
        type: "Uint8Array",
        m: uint8ToBase64(kData),
      };
    } else {
      const idx = typedArrayTypes.findIndex((e) => kData instanceof e);
      if (idx >= 0) {
        const buf = kData.buffer;
        extData = {
          type: typedArrayTypesText[idx],
          m: uint8ToBase64(new Uint8Array(buf)),
        };
      } else {
        throw new Error("Unsupported ArrayBuffer View");
      }
    }
  } else if (kData instanceof Blob) {
    if (kData instanceof File) {
      extData = {
        type: "File",
        m: [innerToBlobUrl(kData), kData?.name, kData?.lastModified],
      };
    } else {
      extData = {
        type: "Blob",
        m: [innerToBlobUrl(kData)],
      };
    }
  } else if (kData instanceof ArrayBuffer) {
    extData = {
      type: "ArrayBuffer",
      m: uint8ToBase64(new Uint8Array(kData)),
    };
  } else if (kData && typeof kData === "object") {
    let str;
    try {
      str = JSON.stringify(kData);
    } catch (_e: any) {
      str = Array.isArray(kData) ? "[]" : "{}";
    }
    extData = {
      type: "object",
      m: str,
    };
  } else if (kData !== null && kData !== undefined) {
    extData = {
      type: typeof kData,
      m: kData,
    };
  }
  return extData;
};
