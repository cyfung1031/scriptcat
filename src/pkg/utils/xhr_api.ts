// console.log('streaming ' + (GM_xmlhttpRequest.RESPONSE_TYPE_STREAM === 'stream' ? 'supported' : 'not supported');

import { isThisBlobObj } from "./utils";

export const TypeHolderKey = "__SCType.5a2Qj__";
export const enum TypeHolderTypes {
  SAFE = 1,
  DOCUMENT = 2,
  BLOB = 4,
  ARRAYBUFFER = 8,
}

export type TypeHolderForDocument =
  | {
      [TypeHolderKey]: TypeHolderTypes.DOCUMENT;
      v: Document;
    }
  | {
      [TypeHolderKey]: TypeHolderTypes.SAFE | TypeHolderTypes.DOCUMENT;
      v: string;
    };

export type TypeHolderForBlob =
  | {
      [TypeHolderKey]: TypeHolderTypes.BLOB;
      v: Blob;
    }
  | {
      [TypeHolderKey]: TypeHolderTypes.SAFE | TypeHolderTypes.BLOB;
      v: never;
    };

export type TypeHolderForArrayBuffer =
  | {
      [TypeHolderKey]: TypeHolderTypes.ARRAYBUFFER;
      v: ArrayBuffer;
    }
  | {
      [TypeHolderKey]: TypeHolderTypes.SAFE | TypeHolderTypes.ARRAYBUFFER;
      v: never;
    };

export type TypeHolder = TypeHolderForDocument | TypeHolderForBlob | TypeHolderForArrayBuffer;

/**
 * ## GM_xmlhttpRequest(details)
 *
 * The `GM_xmlhttpRequest` function allows userscripts to send HTTP requests and handle responses.
 * It accepts a single parameter — an object that defines the request details and callback functions.
 *
 * ---
 * ### Parameters
 *
 * **`details`** — An object describing the HTTP request options:
 *
 * | Property | Type | Description |
 * |-----------|------|-------------|
 * | `method` | `string` | HTTP method (e.g. `"GET"`, `"POST"`, `"PUT"`, `"DELETE"`, `"HEAD"`). |
 * | `url` | `string \| URL \| File \| Blob` | Target URL or file/blob to send. |
 * | `headers` | `Record<string, string>` | Optional headers (e.g. `User-Agent`, `Referer`). Some headers may be restricted on Safari/Android. |
 * | `data` | `string \| Blob \| File \| Object \| Array \| FormData \| URLSearchParams` | Data to send with POST/PUT requests. |
 * | `redirect` | `"follow" \| "error" \| "manual"` | How redirects are handled. |
 * | `cookie` | `string` | Additional cookie to include with the request. |
 * | `cookiePartition` | `object` | (v5.2+) Cookie partition key. |
 * | `topLevelSite` | `string` | Top frame site for partitioned cookies. |
 * | `binary` | `boolean` | Sends data in binary mode. |
 * | `nocache` | `boolean` | Prevents caching of the resource. |
 * | `revalidate` | `boolean` | Forces cache revalidation. |
 * | `timeout` | `number` | Timeout in milliseconds. |
 * | `context` | `any` | Custom value added to the response object. |
 * | `responseType` | `"arraybuffer" \| "blob" \| "json" \| "stream"` | Type of response data. |
 * | `overrideMimeType` | `string` | MIME type override. |
 * | `anonymous` | `boolean` | If true, cookies are not sent with the request. |
 * | `fetch` | `boolean` | Uses `fetch()` instead of `XMLHttpRequest`. Note: disables `timeout` and progress callbacks in Chrome. |
 * | `user` | `string` | Username for authentication. |
 * | `password` | `string` | Password for authentication. |
 *
 * ---
 * ### Callback Functions
 *
 * | Callback | Description |
 * |-----------|-------------|
 * | `onabort(response)` | Called if the request is aborted. |
 * | `onerror(response)` | Called if the request encounters an error. |
 * | `onloadstart(response)` | Called when the request starts. Provides access to the stream if `responseType` is `"stream"`. |
 * | `onprogress(response)` | Called periodically while the request is loading. |
 * | `onreadystatechange(response)` | Called when the request’s `readyState` changes. |
 * | `ontimeout(response)` | Called if the request times out. |
 * | `onload(response)` | Called when the request successfully completes. |
 *
 * ---
 * ### Response Object
 *
 * Each callback receives a `response` object with the following properties:
 *
 * | Property | Type | Description |
 * |-----------|------|-------------|
 * | `finalUrl` | `string` | The final URL after all redirects. |
 * | `readyState` | `number` | The current `readyState` of the request. |
 * | `status` | `number` | The HTTP status code. |
 * | `statusText` | `string` | The HTTP status text. |
 * | `responseHeaders` | `string` | The raw response headers. |
 * | `response` | `any` | Parsed response data (depends on `responseType`). |
 * | `responseXML` | `Document` | Response data as XML (if applicable). |
 * | `responseText` | `string` | Response data as plain text. |
 *
 * ---
 * ### Return Value
 *
 * `GM_xmlhttpRequest` returns an object with:
 * - `abort()` — Function to cancel the request.
 *
 * The promise-based equivalent is `GM.xmlHttpRequest` (note the capital **H**).
 * It resolves with the same `response` object and also provides an `abort()` method.
 *
 * ---
 * ### Example Usage
 *
 * **Callback-based:**
 * ```ts
 * GM_xmlhttpRequest({
 *   method: "GET",
 *   url: "https://example.com/",
 *   headers: { "Content-Type": "application/json" },
 *   onload: (response) => {
 *     console.log(response.responseText);
 *   },
 * });
 * ```
 *
 * **Promise-based:**
 * ```ts
 * const response = await GM.xmlHttpRequest({ url: "https://example.com/" })
 *   .catch(err => console.error(err));
 *
 * console.log(response.responseText);
 * ```
 *
 * ---
 * **Note:**
 * - The `synchronous` flag in `details` is **not supported**.
 * - You must declare appropriate `@connect` permissions in your userscript header.
 */

/**
 * Represents the response object returned to GM_xmlhttpRequest callbacks.
 */
export interface GMResponse<T = any> {
  /** The final URL after redirects */
  finalUrl: string;
  /** Current ready state */
  readyState: number;
  /** HTTP status code */
  status: number;
  /** HTTP status text */
  statusText: string;
  /** Raw response headers */
  responseHeaders: string;
  /** Parsed response data (depends on responseType) */
  response: T;
  /** Response as XML document (if applicable) */
  responseXML?: Document;
  /** Response as plain text */
  responseText: string;
  /** Context object passed from the request */
  context?: any;
}

type GMXHRDataType = string | Blob | File | BufferSource | FormData | URLSearchParams;

/**
 * Represents the request details passed to GM_xmlhttpRequest.
 */
export interface XmlhttpRequestFnDetails<T = any> {
  /** HTTP method (GET, POST, PUT, DELETE, etc.) */
  method?: string;
  /** Target URL or Blob/File source */
  url: string | URL | Blob | File;
  /** Optional headers to include */
  headers?: Record<string, string>;
  /** Data to send with the request */
  data?: GMXHRDataType;
  /** Redirect handling mode */
  redirect?: "follow" | "error" | "manual";
  /** Additional cookie to include */
  cookie?: string;
  /** Partition key for partitioned cookies (v5.2+) */
  cookiePartition?: Record<string, any>;
  /** Top-level site for partitioned cookies */
  topLevelSite?: string;
  /** Send data as binary */
  binary?: boolean;
  /** Disable caching: don’t cache or store the resource at all */
  nocache?: boolean;
  /** Force revalidation of cached content: may cache, but must revalidate before using cached content */
  revalidate?: boolean;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Custom value passed to response.context */
  context?: any;
  /** Type of response expected */
  responseType?: "arraybuffer" | "blob" | "json" | "stream" | "" | "text" | "document"; // document for VM2.12.0+
  /** Override MIME type */
  overrideMimeType?: string;
  /** Send request without cookies (Greasemonkey) */
  mozAnon?: boolean;
  /** Send request without cookies */
  anonymous?: boolean;
  /** Use fetch() instead of XMLHttpRequest */
  fetch?: boolean;
  /** Username for authentication */
  user?: string;
  /** Password for authentication */
  password?: string;
  /** [NOT SUPPORTED] upload (Greasemonkey) */
  upload?: never;
  /** [NOT SUPPORTED] synchronous (Greasemonkey) */
  synchronous?: never;

  /** Called if the request is aborted */
  onabort?: (response: GMResponse<T>) => void;
  /** Called on network error */
  onerror?: (response: GMResponse<T>) => void;
  /** Called when loading starts */
  onloadstart?: (response: GMResponse<T>) => void;
  /** Called on download progress */
  onprogress?: (response: GMResponse<T>) => void;
  /** Called when readyState changes */
  onreadystatechange?: (response: GMResponse<T>) => void;
  /** Called on request timeout */
  ontimeout?: (response: GMResponse<T>) => void;
  /** Called on successful request completion */
  onload?: (response: GMResponse<T>) => void;
}

/**
 * The return value of GM_xmlhttpRequest — includes an abort() function.
 */
export interface GMRequestHandle {
  /** Abort the ongoing request */
  abort: () => void;
}

type ResponseType = "" | "text" | "json" | "blob" | "arraybuffer" | "document";

type ReadyState =
  | 0 // UNSENT
  | 1 // OPENED
  | 2 // HEADERS_RECEIVED
  | 3 // LOADING
  | 4; // DONE

interface ProgressLikeEvent {
  loaded: number;
  total: number;
  lengthComputable: boolean;
}

export class FetchXHR {
  private readonly extraOptsFn: any;
  private readonly isBufferStream: boolean;
  private readonly onDataReceived: any;
  constructor(opts: any) {
    this.extraOptsFn = opts?.extraOptsFn ?? null;
    this.isBufferStream = opts?.isBufferStream ?? false;
    this.onDataReceived = opts?.onDataReceived ?? null;
    //
  }

  // XHR-like constants for convenience
  static readonly UNSENT = 0 as const;
  static readonly OPENED = 1 as const;
  static readonly HEADERS_RECEIVED = 2 as const;
  static readonly LOADING = 3 as const;
  static readonly DONE = 4 as const;

  // Public XHR-ish fields
  readyState: ReadyState = 0;
  status = 0;
  statusText = "";
  responseURL = "";
  responseType: ResponseType = "";
  response: unknown = null;
  responseText = ""; // filled for "" and "text", empty otherwise
  responseXML: TypeHolderForDocument | null = null;
  timeout = 0; // ms; 0 = no timeout
  withCredentials = false; // fetch doesn’t support cookies toggling per-request; kept for API parity

  // Event handlers
  onreadystatechange: ((evt: Partial<Event>) => void) | null = null;
  onloadstart: ((evt: Partial<Event>) => void) | null = null;
  onload: ((evt: Partial<Event>) => void) | null = null;
  onloadend: ((evt: Partial<Event>) => void) | null = null;
  onerror: ((evt: Partial<Event>, err?: Error | string) => void) | null = null;
  onprogress: ((evt: Partial<ProgressLikeEvent> & { type: string }) => void) | null = null;
  onabort: ((evt: Partial<Event>) => void) | null = null;
  ontimeout: ((evt: Partial<Event>) => void) | null = null;

  private isAborted: boolean = false;

  // Internal
  private method: string | null = null;
  private url: string | null = null;
  private headers = new Headers();
  private body: BodyInit | null = null;
  private controller: AbortController | null = null;
  private timedOut = false;
  private timeoutId: number | null = null;
  private _responseHeaders: {
    getAllResponseHeaders: () => string;
    getResponseHeader: (name: string) => string | null;
    cache: Record<any, any>;
  } | null = null;

  open(method: string, url: string, _async?: boolean, username?: string, password?: string) {
    if (username && password !== undefined) {
      this.headers.set("Authorization", "Basic " + btoa(`${username}:${password}`));
    } else if (username && password === undefined) {
      this.headers.set("Authorization", "Basic " + btoa(`${username}:`));
    }
    this.method = method.toUpperCase();
    this.url = url;
    this.readyState = FetchXHR.OPENED;
    this._emitReadyStateChange();
  }

  setRequestHeader(name: string, value: string) {
    this.headers.set(name, value);
  }

  getAllResponseHeaders(): string {
    if (this._responseHeaders === null) return "";
    return this._responseHeaders.getAllResponseHeaders();
  }

  getResponseHeader(name: string): string | null {
    // Per XHR semantics, header names are case-insensitive
    if (this._responseHeaders === null) return null;
    return this._responseHeaders.getResponseHeader(name);
  }

  overrideMimeType(_mime: string) {
    // Not supported by fetch; no-op to keep parity.
  }

  async send(body?: BodyInit | null) {
    if (this.readyState !== FetchXHR.OPENED || !this.method || !this.url) {
      throw new Error("Invalid state: call open() first.");
    }

    this.body = body ?? null;
    this.controller = new AbortController();

    // Setup timeout if specified
    if (this.timeout > 0) {
      this.timeoutId = window.setTimeout(() => {
        if (this.controller) {
          this.timedOut = true;
          this.controller.abort();
        }
      }, this.timeout);
    }

    try {
      const opts = {
        method: this.method,
        headers: this.headers,
        body: this.body,
        signal: this.controller.signal,
        // credentials: 'include' cannot be toggled per request like XHR.withCredentials; set at app level if needed.
      };
      this.extraOptsFn?.(opts);
      this.onloadstart?.({ type: "loadstart" });
      const res = await fetch(this.url, opts);

      // Update status + headers
      this.status = res.status;
      this.statusText = res.statusText ?? "";
      this.responseURL = res.url ?? this.url;
      this._responseHeaders = {
        getAllResponseHeaders(): string {
          let ret: string | undefined = this.cache[""];
          if (ret === undefined) {
            ret = "";
            res.headers.forEach((v, k) => {
              ret += `${k}: ${v}\r\n`;
            });
            this.cache[""] = ret;
          }
          return ret;
        },
        getResponseHeader(name: string): string | null {
          if (!name) return null;
          return (this.cache[name] ||= res.headers.get(name)) as string | null;
        },
        cache: {},
      };

      const ct = res.headers.get("content-type")?.toLowerCase() || "";
      const ctI = ct.indexOf("charset=");
      let encoding = "utf-8"; // fetch defaults are UTF-8
      if (ctI >= 0) {
        let ctJ = ct.indexOf(";", ctI);
        ctJ = ctJ > ctI ? ctJ : ct.length;
        encoding = ct.substring(ctI, ctJ).trim() || encoding;
      }

      this.readyState = FetchXHR.HEADERS_RECEIVED;
      this._emitReadyStateChange();

      let responseOverrided: ReadableStream<Uint8Array> | null = null;

      // Storage buffers for different responseTypes
      // const chunks: Uint8Array<ArrayBufferLike>[] = [];

      // From Chromium 105, you can start a request before you have the whole body available by using the Streams API.
      // https://developer.chrome.com/docs/capabilities/web-apis/fetch-streaming-requests?hl=en
      // -> TextDecoderStream

      let textDecoderStream;
      let textDecoder;
      const receiveAsPlainText =
        this.responseType === "" ||
        this.responseType === "text" ||
        this.responseType === "document" || // SC的處理是把 document 當作 blob 處理。僅保留這處理實現完整工具庫功能
        this.responseType === "json";

      if (receiveAsPlainText) {
        if (typeof TextDecoderStream === "function" && Symbol.asyncIterator in ReadableStream.prototype) {
          // try ReadableStream
          try {
            textDecoderStream = new TextDecoderStream(encoding);
          } catch {
            textDecoderStream = new TextDecoderStream("utf-8");
          }
        } else {
          // fallback to ReadableStreamDefaultReader
          // fatal: true - throw on errors instead of inserting the replacement char
          try {
            textDecoder = new TextDecoder(encoding, { fatal: true, ignoreBOM: true });
          } catch {
            textDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
          }
        }
      }

      // Stream body for progress
      let streamReader;
      let streamReadable;
      if (res.body === null) throw new Error("Response Body is null");
      if (textDecoderStream) {
        streamReadable = res.body?.pipeThrough(new TextDecoderStream(encoding));
        if (!streamReadable) throw new Error("streamReadable is undefined.");
      } else {
        streamReader = res.body?.getReader();
        if (!streamReader) throw new Error("streamReader is undefined.");
      }

      let didLoaded = false;

      const contentLengthHeader = res.headers.get("content-length");
      const total = contentLengthHeader ? Number(contentLengthHeader) : 0;
      let loaded = 0;
      const firstLoad = () => {
        if (!didLoaded) {
          didLoaded = true;
          // Move to LOADING state as soon as we start reading
          this.readyState = FetchXHR.LOADING;
          this._emitReadyStateChange();
        }
      };
      let streamDecoding = false;
      const pushBuffer = (chunk: Uint8Array<ArrayBuffer> | string | undefined | null) => {
        if (!chunk) return;
        const added = typeof chunk === "string" ? chunk.length : chunk.byteLength;
        if (added) {
          loaded += added;
          if (typeof chunk === "string") {
            this.onDataReceived({ chunk: true, type: "text", data: chunk });
          } else if (this.isBufferStream) {
            this.onDataReceived({ chunk: true, type: "stream", data: chunk });
          } else if (receiveAsPlainText) {
            streamDecoding = true;
            const data = textDecoder!.decode(chunk, { stream: true }); // keep decoder state between chunks
            this.onDataReceived({ chunk: true, type: "text", data: data });
          } else {
            this.onDataReceived({ chunk: true, type: "buffer", data: chunk });
          }

          if (this.onprogress) {
            this.onprogress({
              type: "progress",
              loaded, // decoded buffer bytelength. no specification for decoded or encoded. https://developer.mozilla.org/en-US/docs/Web/API/ProgressEvent/loaded
              total, // Content-Length. The total encoded bytelength (gzip/br)
              lengthComputable: false, // always assume compressed data. See https://developer.mozilla.org/en-US/docs/Web/API/ProgressEvent/lengthComputable
            });
          }
        }
      };

      if (this.isBufferStream && streamReader) {
        const streamReaderConst = streamReader;
        let myController = null;
        const makeController = async (controller: ReadableStreamDefaultController<any>) => {
          try {
            while (true) {
              const { done, value } = await streamReaderConst.read();
              firstLoad();
              if (done) break;
              controller.enqueue(new Uint8Array(value));
              pushBuffer(value);
            }
            controller.close();
          } catch {
            controller.error("XHR failed");
          }
        };
        responseOverrided = new ReadableStream<Uint8Array>({
          start(controller) {
            myController = controller;
          },
        });
        this.response = responseOverrided;
        await makeController(myController!);
      } else if (streamReadable) {
        // receiveAsPlainText
        if (Symbol.asyncIterator in streamReadable && typeof streamReadable[Symbol.asyncIterator] === "function") {
          // https://developer.mozilla.org/ja/docs/Web/API/ReadableStream
          //@ts-ignore
          for await (const chunk of streamReadable) {
            firstLoad(); // ensure firstLoad() is always called
            if (chunk.length) {
              pushBuffer(chunk);
            }
          }
        } else {
          const streamReader = streamReadable.getReader();
          try {
            while (true) {
              const { done, value } = await streamReader.read();
              firstLoad(); // ensure firstLoad() is always called
              if (done) break;
              pushBuffer(value);
            }
          } finally {
            streamReader.releaseLock();
          }
        }
      } else if (streamReader) {
        try {
          while (true) {
            const { done, value } = await streamReader.read();
            firstLoad(); // ensure firstLoad() is always called
            if (done) {
              if (streamDecoding) {
                const data = textDecoder!.decode(); // flush trailing bytes
                // this.onDataReceived({ chunk: true, type: "text", data: data });
                pushBuffer(data);
              }
              break;
            }
            pushBuffer(value);
          }
        } finally {
          streamReader.releaseLock();
        }
      } else {
        console.log(211);
        firstLoad();
        // Fallback: no streaming support — read fully
        const buf = new Uint8Array<ArrayBuffer>(await res.arrayBuffer());
        pushBuffer(buf);
        if (streamDecoding) {
          const data = textDecoder!.decode(); // flush trailing bytes
          // this.onDataReceived({ chunk: true, type: "text", data: data });
          pushBuffer(data);
        }
      }

      this.status = res.status;
      this.statusText = res.statusText ?? "";
      this.responseURL = res.url ?? this.url;

      // if (responseOverrided) {
      //   this.responseText = ""; // XHR leaves responseText empty for binary types
      //   this.responseXML = null;
      // } else {
      //   switch (this.responseType) {
      //     case "json": {
      //       this.responseText = text; // XHR exposes responseText even for JSON
      //       this.responseXML = null;
      //       try {
      //         this.response = text.length ? JSON.parse(text) : null; // Object or null
      //       } catch (_e: any) {
      //         // Mirror XHR: if invalid JSON but requested json, surface as error
      //         // throw new Error("Invalid JSON response");
      //         this.response = null;
      //       }
      //       break;
      //     }
      //     case "blob": {
      //       // Assemble the final response based on responseType
      //       const full = concatUint8(chunks);
      //       // Try to preserve Content-Type
      //       const type = res.headers.get("content-type") || "application/octet-stream";
      //       this.response = new Blob([full], { type }); // Blob
      //       this.responseText = ""; // XHR leaves responseText empty for binary types
      //       this.responseXML = null;
      //       break;
      //     }
      //     case "arraybuffer": {
      //       // Assemble the final response based on responseType
      //       const full = concatUint8(chunks);
      //       this.response = full.buffer.slice(full.byteOffset, full.byteOffset + full.byteLength); // ArrayBuffer
      //       this.responseText = "";
      //       this.responseXML = null;
      //       break;
      //     }
      //     case "document": {
      //       this.responseText = "";
      //       this.responseXML = wrapSafeType(text, TypeHolderTypes.DOCUMENT) as TypeHolderForDocument;
      //       this.response = wrapSafeType(text, TypeHolderTypes.DOCUMENT); // SafeDocument
      //       // this.responseXML = textToXMLDoc(text);
      //       break;
      //     }
      //     case "":
      //     case "text":
      //     default: {
      //       this.responseText = text;
      //       this.response = text;
      //       this.responseXML = null;
      //       break;
      //     }
      //   }
      // }

      if (this.isAborted) {
        const err = new Error("AbortError");
        err.name = "AbortError";
        throw err;
      }

      this.readyState = FetchXHR.DONE;
      this._emitReadyStateChange();
      this.onload?.({ type: "load" });
    } catch (err) {
      this.controller = null;
      if (this.timeoutId != null) {
        clearTimeout(this.timeoutId);
        this.timeoutId = null;
      }
      this.status = 0;

      if (this.timedOut) {
        this.ontimeout?.({ type: "timeout" });
        return;
      }

      if ((err as any)?.name === "AbortError") {
        this.readyState = FetchXHR.UNSENT;
        this.onabort?.({ type: "abort" });
        return;
      }

      this.onerror?.({ type: "error" }, (err || "Unknown Error") as Error | string);
    } finally {
      this.controller = null;
      if (this.timeoutId != null) {
        clearTimeout(this.timeoutId);
        this.timeoutId = null;
      }
      this.onloadend?.({ type: "loadend" });
    }
  }

  abort() {
    this.isAborted = true;
    this.controller?.abort();
  }

  // Utility to fire readyState changes
  private _emitReadyStateChange() {
    this.onreadystatechange?.({ type: "readystatechange" });
  }
}

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

/**
 * Greasemonkey/Tampermonkey GM_xmlhttpRequest API.
 * @example
 * GM_xmlhttpRequest({
 *   method: 'GET',
 *   url: 'https://example.com/',
 *   onload: (res) => console.log(res.responseText),
 * });
 */
export const xmlhttpRequestFn = <T = any>(details: XmlhttpRequestFnDetails<T>, settings: any) => {
  /*



cookie a cookie to be patched into the sent cookie set
cookiePartition v5.2+ object?, containing the partition key to be used for sent and received partitioned cookies
topLevelSite string?, representing the top frame site for partitioned cookies

  binary send the data string in binary mode
nocache don't cache the resource
revalidate revalidate maybe cached content


context a property which will be added to the response object

*/

  const anonymous = details.anonymous ?? details.mozAnon ?? false;

  const redirect = details.redirect;

  const isFetch = details.fetch ?? false;

  const isBufferStream = details.responseType === "stream";

  const useFetch = isFetch || !!redirect || anonymous || isBufferStream;
  console.log("useFetch", isFetch, !!redirect, anonymous, isBufferStream);

  const prepareXHR = async () => {
    let rawData =
      settings.encodedData !== undefined ? ((await decodeBody(settings.encodedData)) as GMXHRDataType) : details.data;

    const baseXHR = useFetch
      ? new FetchXHR({
          extraOptsFn: (opts: Record<any, any>) => {
            if (redirect) {
              opts.redirect = redirect;
            }
            if (anonymous) {
              opts.credentials = "omit"; // ensures no cookies or auth headers are sent
            }
          },
          isBufferStream,
          onDataReceived: settings.onDataReceived,
        })
      : new XMLHttpRequest();

    settings.abort = () => {
      baseXHR.abort();
    };

    const url = typeof details.url === "object" ? await convObjectToURL(details.url) : details.url;
    if (details.overrideMimeType) {
      baseXHR.overrideMimeType(details.overrideMimeType);
    }

    let contentType = "";
    let responseHeaders: string | null = null;
    let finalStateChangeEvent: Event | ProgressEvent<EventTarget> | null = null;
    let canTriggerFinalStateChangeEvent = false;
    const callback = (evt: Event | ProgressEvent<EventTarget>, err?: Error | string) => {
      const xhr = baseXHR;
      const eventType = evt.type;

      if (eventType === "load") {
        canTriggerFinalStateChangeEvent = true;
        if (finalStateChangeEvent) callback(finalStateChangeEvent);
      } else if (eventType === "readystatechange" && xhr.readyState === 4) {
        // readyState4 的readystatechange或會重覆，見 https://github.com/violentmonkey/violentmonkey/issues/1862
        if (!canTriggerFinalStateChangeEvent) {
          finalStateChangeEvent = evt;
          return;
        }
      }
      canTriggerFinalStateChangeEvent = false;
      finalStateChangeEvent = null;

      // contentType 和 responseHeaders 只讀一次
      contentType = contentType || xhr.getResponseHeader("Content-Type") || "";
      if (contentType && !responseHeaders) {
        responseHeaders = xhr.getAllResponseHeaders();
      }
      // let response = xhr.response;
      // let responseText;
      // let responseXML: TypeHolderForDocument | null = null;
      // if (details.responseType === "stream") {
      //   responseText = "";
      //   responseXML = null;
      // } else {
      // if (xhr.responseType === "document" && xhr.responseXML instanceof Document) {
      //   // 這個 function 沿用從xhr取得原生 document 物件的設計，然後在外層轉換回傳一般物件型態。
      //   // 這確保xml結果一致
      //   responseText = "";
      //   responseXML = wrapRawType(xhr.responseXML, TypeHolderTypes.DOCUMENT) as TypeHolderForDocument; // TypeHolder_RawDocument
      //   response = wrapRawType(xhr.responseXML, TypeHolderTypes.DOCUMENT); // TypeHolder_RawDocument
      // } else if (xhr.responseType === "document" && xhr instanceof FetchXHR && xhr.responseXML?.[TypeHolderKey]) {
      //   responseText = "";
      //   responseXML = xhr.responseXML; // TypeHolder_SafeDocument
      //   response = xhr.responseXML; // TypeHolder_SafeDocument
      // } else if (response instanceof Blob) {
      //   responseText = "";
      //   responseXML = null;
      //   response = wrapRawType(response, TypeHolderTypes.BLOB);
      // } else if (response instanceof ArrayBuffer) {
      //   responseText = "";
      //   responseXML = null;
      //   response = responseText;
      //   response = wrapRawType(response, TypeHolderTypes.ARRAYBUFFER);
      // } else if (xhr.responseType === "" || xhr.responseType === "text") {
      //   responseText = xhr.responseText; // string
      //   responseXML = null;
      //   response = responseText;
      // } else {
      //   responseText = "";
      //   responseXML = null;
      //   response = null;
      // }
      // }
      console.log(1313000, xhr instanceof FetchXHR, eventType, xhr.responseType, xhr.readyState);
      if (!(xhr instanceof FetchXHR)) {
        const response = xhr.response;
        console.log(1313001, eventType, xhr.responseType);
        if (xhr.readyState === 4 && eventType === "readystatechange") {
          console.log(1313002, eventType, xhr.responseType);
          if (xhr.responseType === "" || xhr.responseType === "text") {
            settings.onDataReceived({ chunk: false, type: "text", data: xhr.responseText });
          } else if (xhr.responseType === "arraybuffer" && response instanceof ArrayBuffer) {
            settings.onDataReceived({ chunk: false, type: "arraybuffer", data: response });
          } else if (xhr.responseType === "blob" && isThisBlobObj(response)) {
            settings.onDataReceived({ chunk: false, type: "blob", data: response });
          } else if (xhr.responseType === "document") {
            // SC的處理是把 document 當作 blob 處理。僅保留這處理實現完整工具庫功能
            let data = "";
            if (response instanceof Document) {
              data = new XMLSerializer().serializeToString(response);
            }
            settings.onDataReceived({ chunk: false, type: "document", data: data });
          } else if (xhr.responseType === "json" && xhr.response && typeof xhr.response === "object") {
            settings.onDataReceived({ chunk: false, type: "json", data: JSON.stringify(xhr.response) });
          }
        }
      }
      settings.callback({
        /*
        
        
          finalUrl: string; // sw handle
          readyState: 0 | 4 | 2 | 3 | 1;
          status: number;
          statusText: string;
          responseHeaders: string;
          error?: string; // sw handle?

          useFetch: boolean,
          eventType: string,
          ok: boolean,
          contentType: string,
          error: undefined | string,

        */

        useFetch: useFetch,
        eventType: eventType,
        ok: xhr.status >= 200 && xhr.status < 300,
        contentType,
        // Always
        readyState: xhr.readyState,
        // After response headers
        status: xhr.status,
        statusText: xhr.statusText,
        // After load
        // response: response,
        // responseText: responseText,
        // responseXML: responseXML,
        // After headers received
        responseHeaders: responseHeaders,
        responseURL: xhr.responseURL,
        // How to get the error message in native XHR ?
        error: eventType !== "error" ? undefined : (err as Error)?.message || err || "Unknown Error",
      });

      evt.type;
    };
    baseXHR.onabort = callback;
    baseXHR.onloadstart = callback;
    baseXHR.onload = callback;
    baseXHR.onerror = callback;
    baseXHR.onprogress = callback;
    baseXHR.ontimeout = callback;
    baseXHR.onreadystatechange = callback;
    baseXHR.onloadend = callback;

    baseXHR.open(details.method ?? "GET", url, true, details.user, details.password);
    // "" | "arraybuffer" | "blob" | "document" | "json" | "text"
    if (details.responseType === "json") {
      // 故意忽略，json -> text，兼容TM
    } else if (details.responseType === "stream") {
      baseXHR.responseType = "arraybuffer";
    } else if (details.responseType) {
      baseXHR.responseType = details.responseType;
    }
    if (details.timeout) baseXHR.timeout = details.timeout;
    baseXHR.withCredentials = true;

    // Apply headers
    if (details.headers) {
      for (const [key, value] of Object.entries(details.headers)) {
        baseXHR.setRequestHeader(key, value);
      }
    }

    if (details.nocache) {
      // Never cache anything (always fetch new)
      //
      // Explanation:
      // - The browser and proxies are not allowed to store this response anywhere.
      // - Useful for sensitive or secure data (like banking info or private dashboards).
      // - Ensures no cached version exists on disk, in memory, or in intermediary caches.
      //
      baseXHR.setRequestHeader("Cache-Control", "no-cache, no-store");
      baseXHR.setRequestHeader("Pragma", "no-cache"); // legacy HTTP/1.0 fallback
      baseXHR.setRequestHeader("Expires", "0"); // legacy HTTP/1.0 fallback
    } else if (details.revalidate) {
      // Cache is allowed but must verify with server
      //
      // Explanation:
      // - The response can be cached locally, but it’s marked as “immediately stale”.
      // - On each request, the browser must check with the server (via ETag or Last-Modified)
      //   to confirm whether it can reuse the cached version.
      // - Ideal for data that rarely changes but should always be validated for freshness.
      //
      baseXHR.setRequestHeader("Cache-Control", "max-age=0, must-revalidate");
    }

    // // --- Handle request body ---
    // if (
    //   rawData instanceof URLSearchParams ||
    //   typeof rawData === "string" ||
    //   rawData instanceof Blob ||
    //   rawData instanceof FormData
    // ) {
    //   requestInit.body = rawData as BodyInit;
    // } else if (rawData && typeof rawData === "object" && !(rawData instanceof ArrayBuffer)) {
    //   // JSON body
    //   requestInit.body = JSON.stringify(rawData);
    //   if (!headers.has("Content-Type")) {
    //     headers.set("Content-Type", "application/json");
    //   }
    // }

    // // --- Handle cookies (if any) ---
    // if (cookie) {
    //   requestInit.headers ||= {};
    //   // if (!headers.has("Cookie")) {
    //   headers.set("Cookie", cookie);
    //   // }
    // }

    // --- Handle request body ---
    if (
      rawData instanceof URLSearchParams ||
      typeof rawData === "string" ||
      isThisBlobObj(rawData) ||
      rawData instanceof FormData
    ) {
      //
    } else if (rawData && typeof rawData === "object" && !(rawData instanceof ArrayBuffer)) {
      if ((baseXHR.getResponseHeader("Content-Type") || "application/json") !== "application/json") {
        // JSON body
        rawData = JSON.stringify(rawData);
        baseXHR.setRequestHeader("Content-Type", "application/json");
      } else {
        rawData = undefined;
      }
    }

    // Send data (if any)
    baseXHR.send(rawData ?? null);
  };

  prepareXHR();
};

/**
 * Promise-based version of GM_xmlhttpRequest (with capital "H").
 * @example
 * const res = await GM.xmlHttpRequest({ url: 'https://example.com/' });
 * console.log(res.responseText);
 */
/*
export const xmlhttpRequestFnAsync = <T = any>(
  details: GMRequestDetails<T>
): Promise<GMResponse<T>> & GMRequestHandle => {
  let abort = null;
  const ret = new Promise((resolve, reject) => {
    const r = xmlhttpRequestFn(details);
    abort = r.abort;
  }) as Promise<GMResponse<T>> & GMRequestHandle;
  ret.abort = abort!;
  return ret;
};
*/

/**
 * Polyfill encoder for browser's inability to send complex types over extension messaging
 * (Counterpart to decodeBody)
 */
export async function encodeBody(body: GMXHRDataType): Promise<EncodedBody | null | undefined | string> {
  if (!body) {
    return body as null | undefined | "";
  }
  if (body instanceof ReadableStream) {
    body = await new Response(body).blob();
  }

  // --- FormData ---
  if (body instanceof FormData) {
    // Turn into an array of [key, value]
    const arr = [] as [
      string,
      (
        | string
        | {
            dataURL: string;
            filename?: string;
            type: string;
          }
      ),
    ][];
    for (const [key, value] of body.entries()) {
      // If it's a Blob/File, we can't send it directly → convert to base64 data URL
      if (isThisBlobObj(value)) {
        const valueBlob = value as Blob | File;
        const base64 = await blobToDataURL(valueBlob);
        if ((valueBlob as File).name) {
          // File
          arr.push([key, { dataURL: base64, filename: (valueBlob as File).name, type: valueBlob.type }]);
        } else {
          // Blob
          arr.push([key, { dataURL: base64, type: valueBlob.type }]);
        }
      } else {
        arr.push([key, `${value}`]);
      }
    }
    return [arr, "fd"];
  }

  // --- URLSearchParams ---
  if (body instanceof URLSearchParams) {
    return [body.toString(), "usp"];
  }

  // --- Blob / File ---
  if (body instanceof Blob) {
    const dataURL = await blobToDataURL(body);
    return [dataURL, body.type || "application/octet-stream"];
  }

  // --- ArrayBuffer or TypedArray ---
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    const uint8 = new Uint8Array<ArrayBuffer>(body instanceof ArrayBuffer ? body : body.buffer);
    const dataURL = uint8ToDataURL(uint8, "application/octet-stream");
    return [dataURL, "application/octet-stream"];
  }

  // --- String or JSON object ---
  if (typeof body === "object") {
    // Assume JSON
    let str;
    try {
      str = JSON.stringify(body);
    } catch (_e: any) {
      str = Array.isArray(body) ? "[]" : "{}";
    }
    const blob = new Blob([str], { type: "application/json" });
    const dataURL = await blobToDataURL(blob);
    return [dataURL, blob.type];
  }

  // --- Raw string ---
  return body;
}

/**
 * Counterpart to encodeBody(body): decodes a transported body triple back into a sendable body.
 * Input tuple:  [encodedBody, type, wasBlob]
 * Output tuple: [decodedBody, contentType]
 *
 * - type === 'fd'  -> reconstruct FormData from flattened entries
 * - type === 'usp' -> set application/x-www-form-urlencoded;charset=UTF-8
 * - other truthy   -> treat encodedBody as a data URL, decode to bytes (Uint8Array)
 * - null/undefined -> passthrough (string/undefined/null/etc.)
 */

const FORM_URLENCODED = "application/x-www-form-urlencoded";
const CHARSET_UTF8 = "charset=UTF-8";

type EncodedBodyFD = [
  string,
  (
    | string
    | {
        dataURL: string;
        filename?: string;
        type: string;
      }
  ),
];

export type EncodedBody =
  | [encoded: EncodedBodyFD[], type: "fd"]
  | [encoded: string, type: "usp"]
  | [encoded: string, type: string] // data URL + MIME hint
  | [encoded: string, type: null];

export type DecodedBody = [body: BodyInit | Uint8Array<ArrayBufferLike>, contentType: string | null];

export async function decodeBody(
  x: EncodedBody | null | undefined | string
): Promise<DecodedBody | null | undefined | string> {
  if (!x || typeof x === "string") return x;
  const [body, type] = x;
  // ---- FormData ----
  if (type === "fd") {
    // Expecting `body` to be an array of [key, value].
    // Values that look like data URLs will be turned back into Blob; others remain strings.
    const fd = new FormData();
    const entries = (body as EncodedBodyFD[]) ?? [];
    for (const [key, val] of entries) {
      if (typeof val === "string") {
        fd.append(key, String(val));
      } else if (val.filename) {
        const { mime, data } = parseDataURL(val.dataURL);
        const type = val.type || mime || "application/octet-stream";
        const filename = typeof val.filename === "string" ? val.filename : "blob";
        const file = new File([data], filename, { type });
        fd.append(key, file);
      } else {
        const { mime, data } = parseDataURL(val.dataURL);
        const type = val.type || mime || "application/octet-stream";
        const blob = new Blob([data], { type });
        // We don't have a preserved filename; browsers will use "blob" by default.
        fd.append(key, blob);
      }
    }
    return [fd, ""]; // let the browser set multipart/form-data; boundary=...
  }

  // ---- URLSearchParams string ----
  if (type === "usp") {
    // Body should already be a serialized string like "a=1&b=2"
    return [body as string, `${FORM_URLENCODED};${CHARSET_UTF8}`];
  }

  // ---- data URL -> bytes (Uint8Array) ----
  if (type !== null) {
    // `body` should be a data URL string e.g. "data:<mime>;base64,AAAA..."
    const { mime, data } = parseDataURL(String(body));
    const contentType = mime || String(type) || "application/octet-stream";
    return [data, contentType];
  }

  // ---- passthrough (plain string) ----
  return body;
}

/* ---------- Helper functions ---------- */

/** Convert a Blob/File to base64 data URL */
function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.onabort = reject;
    reader.readAsDataURL(blob);
  });
}

/** Convert Uint8Array to base64 data URL of given MIME */
function uint8ToDataURL(uint8: Uint8Array<ArrayBufferLike>, mimeType: string): string {
  const encoded = uint8ToBase64(uint8);
  return `data:${mimeType};base64,${encoded}`;
}

/**
 * Parse a data URL into { mime, data }.
 * Supports base64 and (rare) non-base64 payloads. For our use it’s base64.
 */
function parseDataURL(url: string): { mime: string | null; data: Uint8Array<ArrayBuffer> } {
  if (!url.startsWith("data:")) throw new Error("Expected a data URL");
  // data:[<media-type>][;base64],<data>
  const commaIdx = url.indexOf(",");
  if (commaIdx < 0) throw new Error("Malformed data URL");

  const meta = url.slice(5, commaIdx); // [<media-type>][;base64],
  const payload = url.slice(commaIdx + 1); // <data>
  const isBase64 = meta.includes(";base64");
  const j = meta.indexOf(";");
  const mime = j > 0 ? meta.substring(0, j) : null;

  if (isBase64) return { mime, data: base64ToUint8(payload) };

  // Ensure ArrayBuffer backing
  const bytes = new TextEncoder().encode(decodeURIComponent(payload));
  const ab = new ArrayBuffer(bytes.byteLength);
  const result = new Uint8Array<ArrayBuffer>(ab);
  result.set(bytes);
  return { mime, data: result };
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

export function textToXMLDoc(text: string): Document {
  if (typeof DOMParser === "undefined") {
    throw new Error("DOMParser is undefined. It should not be called directly in Service Worker.");
  }
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(text, "application/xml");
  return xmlDoc;
}

// function wrapRawType(v: any, type: number): TypeHolder {
//   return {
//     [TypeHolderKey]: type,
//     v: v,
//   };
// }

// function wrapSafeType(v: any, type: number): TypeHolder {
//   return {
//     [TypeHolderKey]: type | TypeHolderTypes.SAFE,
//     v: v,
//   };
// }

export const convObjectToURL = async (object: string | URL | Blob | File | undefined | null) => {
  let url = "";
  if (typeof object === "string") {
    url = object;
  } else if (object instanceof URL) {
    url = object.href;
  } else if (object instanceof Blob) {
    // 不使用 blob URL
    // 1. service worker 不能生成 blob URL
    // 2. blob URL 有效期管理麻煩

    const blob = object;
    url = await blobToDataURL(blob);
    await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string; // e.g., "data:text/plain;base64,SGVsbG8gd29ybGQh"
        resolve(dataUrl);
      };
      reader.onerror = reject;
      reader.onabort = reject;

      reader.readAsDataURL(blob);
    });
  }
  return url;
};

// Split Uint8Array (or ArrayBuffer) into 2MB chunks as Uint8Array views
export function chunkUint8(src: Uint8Array | ArrayBuffer, chunkSize = 2 * 1024 * 1024) {
  const u8 = src instanceof Uint8Array ? src : new Uint8Array(src);
  const chunks = [];
  for (let i = 0; i < u8.length; i += chunkSize) {
    chunks.push(u8.subarray(i, Math.min(i + chunkSize, u8.length)));
  }
  return chunks; // array of Uint8Array views
}

// function mergeUint8Chunks(chunks) {
//   let totalLength = 0;
//   for (const chunk of chunks) {
//     result.set(chunk, offset);
//     offset += chunk.length;
//   }
//   const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
//   const result = new Uint8Array(totalLength);

//   let offset = 0;
//   for (const chunk of chunks) {
//     result.set(chunk, offset);
//     offset += chunk.length;
//   }

//   return result; // Uint8Array
// }
