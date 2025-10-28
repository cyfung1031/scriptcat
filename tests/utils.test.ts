import { afterAll, beforeAll, describe, expect, it, vi, vitest } from "vitest";
import { addTestPermission, initTestGMApi } from "./utils";
import { randomUUID } from "crypto";
import { newMockXhr } from "mock-xmlhttprequest";
import type { Script, ScriptRunResource } from "@App/app/repo/scripts";
import { ScriptDAO } from "@App/app/repo/scripts";
import GMApi from "@App/app/service/content/gm_api";
import { isThisBlobObj } from "@App/pkg/utils/utils";
import { setMockNetworkResponse } from "./shared";

const realXMLHttpRequest = global.XMLHttpRequest;

beforeAll(() => {
  const mockXhr = newMockXhr();
  mockXhr.onSend = async (request) => {
    return request.respond(200, o.responseHeaders, o.responseContent);
  };
  vi.stubGlobal("XMLHttpRequest", mockXhr);
});

afterAll(() => {
  vi.stubGlobal("XMLHttpRequest", realXMLHttpRequest);
});

const o = {
  responseHeaders: {},
  responseContent: null,
} as Record<any, any>;

describe("测试GMApi环境 - XHR", async () => {
  const msg = initTestGMApi();
  const script: Script = {
    uuid: randomUUID(),
    name: "test",
    metadata: {
      grant: [
        // gm xhr
        "GM_xmlhttpRequest",
      ],
      connect: ["example.com"],
    },
    namespace: "",
    type: 1,
    status: 1,
    sort: 0,
    runStatus: "running",
    createtime: 0,
    checktime: 0,
  };

  addTestPermission(script.uuid);
  await new ScriptDAO().save(script);
  const gmApi = new GMApi("serviceWorker", msg, <ScriptRunResource>{
    uuid: script.uuid,
  });
  it("test GM xhr - plain text", async () => {
    o.responseHeaders = {};
    o.responseContent = "example";
    const onload = vitest.fn();
    await new Promise((resolve) => {
      gmApi.GM_xmlhttpRequest({
        url: "https://mock-xmlhttprequest.test/",
        onload: (res) => {
          resolve(true);
          onload(res.responseText);
        },
        onloadend: () => {
          resolve(false);
        },
      });
    });
    expect(onload).toBeCalled();
    expect(onload.mock.calls[0][0]).toBe("example");
  });
  it("test GM xhr - plain text [fetch]", async () => {
    setMockNetworkResponse("https://mock-xmlhttprequest.test/", {
      data: "Response for GET https://mock-xmlhttprequest.test/",
      contentType: "text/plain",
    });
    const onload = vitest.fn();
    await new Promise((resolve) => {
      gmApi.GM_xmlhttpRequest({
        fetch: true,
        url: "https://mock-xmlhttprequest.test/",
        onload: (res) => {
          resolve(true);
          onload(res.responseText);
        },
        onloadend: () => {
          resolve(false);
        },
      });
    });
    expect(onload).toBeCalled();
    expect(onload.mock.calls[0][0]).toBe("Response for GET https://mock-xmlhttprequest.test/");
  });
  it("test GM xhr - blob", async () => {
    // Define a simple HTML page as a string
    const htmlContent = `
  <!DOCTYPE html>
  <html>
  <head>
    <title>Blob HTML Example</title>
  </head>
  <body>
    <h1>Hello from a Blob!</h1>
    <p>This HTML page is generated from a JavaScript Blob object.</p>
  </body>
  </html>
  `;

    // Create a Blob object from the HTML string
    const blob = new Blob([htmlContent], { type: "text/html" });
    o.responseHeaders = {};
    o.responseContent = blob;
    const fn1 = vitest.fn();
    const fn2 = vitest.fn();
    await new Promise((resolve) => {
      gmApi.GM_xmlhttpRequest({
        url: "https://mock-xmlhttprequest.test/",
        responseType: "blob",
        onload: (res) => {
          o.responseContent = "";
          if (!isThisBlobObj(res.response)) {
            resolve(false);
            return;
          }
          fn2(res.response);
          (res.response as Blob).text().then((text) => {
            resolve(true);
            fn1(text);
          });
        },
        onloadend: () => {
          o.responseContent = "";
          resolve(false);
        },
      });
    });
    expect(fn1).toBeCalled();
    expect(fn1.mock.calls[0][0]).toBe(htmlContent);
    expect(fn2.mock.calls[0][0]).not.toBe(blob);
  });

  it("test GM xhr - blob [fetch]", async () => {
    // Define a simple HTML page as a string
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <title>Blob HTML Example</title>
</head>
<body>
  <h1>Hello from a Blob!</h1>
  <p>This HTML page is generated from a JavaScript Blob object.</p>
</body>
</html>
`;

    // Create a Blob object from the HTML string
    const blob = new Blob([htmlContent], { type: "text/html" });

    setMockNetworkResponse("https://mock-xmlhttprequest.test/", {
      data: htmlContent,
      contentType: "text/html",
      blob: true,
    });
    const fn1 = vitest.fn();
    const fn2 = vitest.fn();
    await new Promise((resolve) => {
      gmApi.GM_xmlhttpRequest({
        fetch: true,
        responseType: "blob",
        url: "https://mock-xmlhttprequest.test/",
        onload: (res) => {
          if (!isThisBlobObj(res.response)) {
            resolve(false);
            return;
          }
          fn2(res.response);
          (res.response as Blob).text().then((text) => {
            resolve(true);
            fn1(text);
          });
        },
        onloadend: () => {
          resolve(false);
        },
      });
    });
    expect(fn1).toBeCalled();
    expect(fn1.mock.calls[0][0]).toBe(htmlContent);
    expect(fn2.mock.calls[0][0]).not.toBe(blob);
  });

  it("test GM xhr - json", async () => {
    // Create a Blob object from the HTML string
    const jsonObj = { code: 100, result: { a: 3, b: [2, 4], c: ["1", "2", "4"], d: { e: [1, 3], f: "4" } } };
    const jsonObjStr = JSON.stringify(jsonObj);

    o.responseHeaders = { "Content-Type": "application/json" };
    o.responseContent = jsonObjStr;
    const fn1 = vitest.fn();
    const fn2 = vitest.fn();
    await new Promise((resolve) => {
      gmApi.GM_xmlhttpRequest({
        url: "https://mock-xmlhttprequest.test/",
        responseType: "json",
        onload: (res) => {
          o.responseHeaders = {};
          o.responseContent = "";
          resolve(true);
          fn1(res.responseText);
          fn2(res.response);
        },
        onloadend: () => {
          o.responseHeaders = {};
          o.responseContent = "";
          resolve(false);
        },
      });
    });
    expect(fn1).toBeCalled();
    expect(fn1.mock.calls[0][0]).toBe(jsonObjStr);
    expect(fn2.mock.calls[0][0]).toStrictEqual(jsonObj);
  });

  it("test GM xhr - json [fetch]", async () => {
    // Create a Blob object from the HTML string
    const jsonObj = { code: 100, result: { a: 3, b: [2, 4], c: ["1", "2", "4"], d: { e: [1, 3], f: "4" } } };
    const jsonObjStr = JSON.stringify(jsonObj);

    setMockNetworkResponse("https://mock-xmlhttprequest.test/", {
      data: jsonObjStr,
      contentType: "application/json",
    });
    const fn1 = vitest.fn();
    const fn2 = vitest.fn();
    await new Promise((resolve) => {
      gmApi.GM_xmlhttpRequest({
        fetch: true,
        url: "https://mock-xmlhttprequest.test/",
        responseType: "json",
        onload: (res) => {
          o.responseHeaders = {};
          o.responseContent = "";
          resolve(true);
          fn1(res.responseText);
          fn2(res.response);
        },
        onloadend: () => {
          o.responseHeaders = {};
          o.responseContent = "";
          resolve(false);
        },
      });
    });
    expect(fn1).toBeCalled();
    expect(fn1.mock.calls[0][0]).toBe(jsonObjStr);
    expect(fn2.mock.calls[0][0]).toStrictEqual(jsonObj);
  });
});
