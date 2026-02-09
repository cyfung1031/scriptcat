import * as path from "path";
import { defineConfig } from "@rspack/cli";
import { rspack } from "@rspack/core";
import { readFileSync } from "fs";
import { NormalModule } from "@rspack/core";
import { v4 as uuidv4 } from "uuid";

import type { Compiler, Compilation } from "@rspack/core";
import pako from "pako";

import * as acorn from "acorn";
import MagicString from "magic-string";

/*
function compileDecodeSource(templateCode: string, base64Data: string) {
  return `
(async () => {
  const b64 = "${base64Data}";
  const buf = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const ds = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  writer.write(buf);
  writer.close();
  const zzstrs = JSON.parse(await new Response(ds.readable).text());
  ((zzstrs) => {
    ${templateCode}
  })(zzstrs);
})();`.trim();
}
*/

function compileDecodeSource(templateCode: string, base64Data: string) {
  return `
(() => {
  // 1. Decode Base64 to Uint8Array
  const b64 = "${base64Data}";


  
  

const inflate = (b64) => {
  // 1. Setup Input (Binary String -> Uint8Array)
  const binStr = atob(b64);
  const input = new Uint8Array(binStr.length);
  for (let i = 0; i < binStr.length; i++) input[i] = binStr.charCodeAt(i);

  // 2. Setup Output (Dynamic Uint8Array)
  // Start with a reasonable size (e.g., 4x input or 32KB) to minimize resizing
  let out = new Uint8Array(Math.max(binStr.length * 4, 32768));
  let outIdx = 0;

  // Helper: Resize output buffer if needed
  const ensure = (extra) => {
    if (outIdx + extra > out.length) {
      const newOut = new Uint8Array(out.length * 2 + extra);
      newOut.set(out);
      out = newOut;
    }
  };

  // 3. Bit Reader
  let bitBuf = 0, bitLen = 0, inpIdx = 0;
  const readBits = (n) => {
    while (bitLen < n) {
      if (inpIdx >= input.length) break;
      // OR-ing with existing buffer. 
      // Important: input byte is unsigned, but shift result is 32-bit signed.
      bitBuf |= input[inpIdx++] << bitLen; 
      bitLen += 8;
    }
    const res = bitBuf & ((1 << n) - 1);
    // CRITICAL FIX: Use >>> (zero-fill right shift) to prevent sign extension
    // if bitBuf becomes negative (which happens if bit 31 is set).
    bitBuf >>>= n; 
    bitLen -= n;
    return res;
  };

  // 4. Tables
  const ord = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
  const lensOf0 = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  const ex0 = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  const distsOf1 = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  const ex1 = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

  // 5. Optimized Tree Builder
  // Creates a lookup table that allows O(1) decoding per bit length
  const buildTree = (lens) => {
    // 1. Count frequencies of each bit length
    const counts = new Int32Array(16);
    for (let i = 0; i < lens.length; i++) {
      if (lens[i] > 0) counts[lens[i]]++; // FIX: Ignore length 0 (unused)
    }

    // 2. Compute starting code for each length (Canonical Huffman)
    const firstCode = new Int32Array(16);
    const offsets = new Int32Array(16);
    let code = 0;
    let currentOffset = 0;

    for (let i = 1; i <= 15; i++) {
      code = (code + counts[i - 1]) << 1;
      firstCode[i] = code;
      offsets[i] = currentOffset;
      currentOffset += counts[i];
    }

    // 3. Sort symbols by length to allow direct lookup
    const sortedSyms = new Uint16Array(lens.length);
    const nextOffset = new Int32Array(offsets); // Copy of offsets
    for (let i = 0; i < lens.length; i++) {
      const l = lens[i];
      if (l > 0) {
        sortedSyms[nextOffset[l]++] = i; 
      }
    }

    return { counts, firstCode, offsets, sortedSyms };
  };

  const decodeSymbol = (tree) => {
    let code = 0;
    // Iterate bits 1 to 15 (max Huffman length)
    for (let len = 1; len <= 15; len++) {
      code = (code << 1) | readBits(1);
      const count = tree.counts[len];
      if (count > 0) { // Only check if codes exist for this length
        const first = tree.firstCode[len];
        const diff = code - first;
        // If code is in range for this length
        if (diff < count && diff >= 0) {
           return tree.sortedSyms[tree.offsets[len] + diff];
        }
      }
    }
    return -1; // Should not happen on valid stream
  };

  // 6. Main Decompression Loop
  let isFinal = 0;
  while (!isFinal) {
    isFinal = readBits(1);
    const type = readBits(2);

    if (type === 0) { // Uncompressed
      bitBuf = bitLen = 0; // Align to byte boundary
      const len = input[inpIdx++] | (input[inpIdx++] << 8);
      inpIdx += 2; // Skip nlen
      ensure(len);
      // Fast block copy
      out.set(input.subarray(inpIdx, inpIdx + len), outIdx);
      outIdx += len;
      inpIdx += len;

    } else { // Compressed
      let lTree, dTree;
      if (type === 1) { // Fixed
        const ls = new Uint8Array(288);
        ls.fill(8, 0, 144); ls.fill(9, 144, 256); ls.fill(7, 256, 280); ls.fill(8, 280, 288);
        const ds = new Uint8Array(32).fill(5);
        lTree = buildTree(ls);
        dTree = buildTree(ds);
      } else { // Dynamic
        const hlit = readBits(5) + 257;
        const hdist = readBits(5) + 1;
        const hclen = readBits(4) + 4;
        
        const clens = new Uint8Array(19);
        for (let i = 0; i < hclen; i++) clens[ord[i]] = readBits(3);
        const clTree = buildTree(clens);
        
        const allLens = new Uint8Array(hlit + hdist);
        let i = 0;
        while (i < hlit + hdist) {
          const s = decodeSymbol(clTree);
          if (s < 16) allLens[i++] = s;
          else {
            let r = 0, val = 0;
            if (s === 16) { r = 3 + readBits(2); val = allLens[i - 1]; }
            else if (s === 17) { r = 3 + readBits(3); val = 0; }
            else { r = 11 + readBits(7); val = 0; }
            while (r--) allLens[i++] = val;
          }
        }
        lTree = buildTree(allLens.subarray(0, hlit));
        dTree = buildTree(allLens.subarray(hlit));
      }

      // Decode Huffman Block
      while (true) {
        const s = decodeSymbol(lTree);
        if (s < 256) { // Literal
          ensure(1);
          out[outIdx++] = s;
        } else if (s === 256) { // End of Block
          break;
        } else { // Match
          const si = s - 257;
          let length = lensOf0[si] + readBits(ex0[si]);
          const di = decodeSymbol(dTree);
          let dist = distsOf1[di] + readBits(ex1[di]);
          
          let pos = outIdx - dist;
          ensure(length);
          // Tight loop for reference copy (handling overlap)
          while (length--) {
            out[outIdx++] = out[pos++];
          }
        }
      }
    }
  }

  return new TextDecoder().decode(out.subarray(0, outIdx));
};


const decodedText = inflate(b64);





  const zzstrs = JSON.parse(decodedText);
  ((zzstrs) => {
    ${templateCode}
  })(zzstrs);
})();`.trim();
}

// ──────────────────────────────────────────────────────────────
// Collect all TemplateLiteral nodes recursively (no extra walk lib)
function collectTemplateLiterals(node: any, templates: any[] = []): any[] {
  if (Array.isArray(node)) {
    node.forEach((child) => collectTemplateLiterals(child, templates));
    return templates;
  }

  if (node && typeof node === "object" && node !== null) {
    if (node.type === "TemplateLiteral") {
      templates.push(node);
    }

    for (const key of Object.keys(node)) {
      if (key !== "parent" && key !== "leadingComments") {
        collectTemplateLiterals(node[key], templates);
      }
    }
  }

  return templates;
}

// ──────────────────────────────────────────────────────────────
class ZipExecutionPlugin {
  apply(compiler: Compiler) {
    compiler.hooks.thisCompilation.tap("ZipExecutionPlugin", (compilation: Compilation) => {
      compilation.hooks.processAssets.tapPromise(
        {
          name: "ZipExecutionPlugin",
          stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE,
        },
        async (assets) => {
          for (const filename of Object.keys(assets)) {
            if (!filename.includes("ts.worker.js")) continue;

            let source = assets[filename].source().toString();
            source = source.replace(/\r\n|\r|\n/g, "\n");
            source = source.replace(/\.(join|split)\(`([\t\x20]*?)\n\n([\t\x20]*?)`\)/g, ".$1('$2\\n\\n$3')");
            source = source.replace(/\.(join|split)\(`([\t\x20]*?)\n([\t\x20]*?)`\)/g, ".$1('$2\\n$3')");
            source = source.replace(/(\w)\+=`([\t\x20]*?)\n\n([\t\x20]*?)`/g, "$1+='$2\\n\\n$3'");
            source = source.replace(/(\w)\+=`([\t\x20]*?)\n([\t\x20]*?)`/g, "$1+='$2\\n$3'");

            source = source.replace(/(\w)\+=`([\t\x20]*?)\n[\s\w:\-+]+\n([\t\x20]*?)`/g, (x) => {
              let s = x.split("`");
              s = [s[0], s[1].replace(/\n/g, "\\n"), s[2]];
              return s.join("'");
            });

            source = source.replace(/(\w)\+=`([\t\x20]*?)\n[\s\w:\-+${}()[\].'"]+\n([\t\x20]*?)`/g, (x) => {
              let s = x.split("`");
              if (
                s[1].split("(").length === s[1].split(")").length &&
                s[1].split("{").length === s[1].split("}").length &&
                s[1].split("[").length === s[1].split("]").length &&
                s[1].split("'").length === s[1].split("'").length &&
                s[1].split('"').length === s[1].split('"').length
              ) {
                s = [s[0], s[1].replace(/\n/g, "\\n"), s[2]];
                return s.join("`");
              } else {
                return x;
              }
            });

            source = source.replace(/\.writeSync\(\w+,`([\t\x20]*?)[\t\x20\n\]]+([\t\x20]*?)`\)/g, (x) => {
              let s = x.split("`");
              s = [s[0], s[1].replace(/\n/g, "\\n"), s[2]];
              return s.join("'");
            });

            source = source.replace(/\.replace\([/\\\w]+,`([\t\x20]*?)[\t\x20*\n\]]+([\t\x20]*?)`\)/g, (x) => {
              let s = x.split("`");
              s = [s[0], s[1].replace(/\n/g, "\\n"), s[2]];
              return s.join("'");
            });

            let ast;
            try {
              ast = acorn.parse(source, {
                ecmaVersion: "latest",
                sourceType: "module",
                ranges: true,
              });
            } catch (err) {
              console.warn(`[ZipExec] Parse failed ${filename}:`, (err as Error).message);
              continue;
            }

            const templates = collectTemplateLiterals(ast);
            if (templates.length === 0) continue;

            const ms = new MagicString(source);
            const extractedRaw: string[] = [];

            // Bottom-up: process deepest templates first
            const sortedTemplates = [...templates].sort((a, b) => b.start - a.start);

            for (const tpl of sortedTemplates) {
              // Critical: skip tagged templates (semantics would break)
              if (tpl.parent?.type === "TaggedTemplateExpression") continue;

              // Right-to-left inside this template (safe for length changes)
              const sortedQuasis = [...tpl.quasis].sort((a, b) => b.start - a.start);

              for (const quasi of sortedQuasis) {
                const raw = quasi.value.raw;
                if (!raw || raw.length <= 15) continue; // skip very short / empty

                const idx = extractedRaw.length;
                extractedRaw.push(raw);

                // Replace static content only → becomes ${zzstrs[idx]}
                ms.overwrite(quasi.start, quasi.end, `\${zzstrs[${idx}]}`);
              }
            }

            if (extractedRaw.length === 0) continue;

            // Compress the array of raw quasi strings
            let compressedBase64: string;
            try {
              const json = JSON.stringify(extractedRaw);
              const bytes = Buffer.from(json, "utf8");
              const deflated = pako.deflateRaw(bytes, { level: 1 }); // 6 = good ratio/speed
              compressedBase64 = Buffer.from(deflated).toString("base64");
            } catch (err) {
              console.warn(`[ZipExec] Compression failed ${filename}:`, (err as Error).message);
              continue;
            }

            const newSource = compileDecodeSource(ms.toString(), compressedBase64);

            compilation.updateAsset(filename, new compiler.webpack.sources.RawSource(newSource));

            console.log(`[ZipExecutionPlugin] Processed ${filename}: ` + `${extractedRaw.length} strings extracted`);
          }
        }
      );
    });
  }
}

const pkg = JSON.parse(readFileSync("./package.json", "utf-8"));

const version = pkg.version;
const dirname = path.resolve();
const isDev = process.env.NODE_ENV === "development";
const isBeta = version.includes("-");

// Target browsers, see: https://github.com/browserslist/browserslist
// 依照 https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/userScripts#browser_compatibility
const targets = ["chrome >= 120", "edge >= 120", "firefox >= 136"];

const src = path.join(dirname, "src");
const dist = path.join(dirname, "dist");
const assets = path.join(src, "assets");

// 排除这些文件，不进行分离
const chunkExcludeSet = new Set([
  "editor.worker",
  "ts.worker",
  "linter.worker",
  "service_worker",
  "content",
  "inject",
  "scripting",
]);

export default defineConfig({
  ...(isDev
    ? {
        watch: true,
        mode: "development",
        devtool: process.env.NO_MAP === "true" ? false : "inline-source-map",
      }
    : {
        mode: "production",
        devtool: false,
      }),
  context: dirname,
  entry: {
    service_worker: `${src}/service_worker.ts`,
    offscreen: `${src}/offscreen.ts`,
    sandbox: `${src}/sandbox.ts`,
    content: `${src}/content.ts`,
    scripting: `${src}/scripting.ts`,
    inject: `${src}/inject.ts`,
    popup: `${src}/pages/popup/main.tsx`,
    install: `${src}/pages/install/main.tsx`,
    batchupdate: `${src}/pages/batchupdate/main.tsx`,
    confirm: `${src}/pages/confirm/main.tsx`,
    import: `${src}/pages/import/main.tsx`,
    options: `${src}/pages/options/main.tsx`,
    "editor.worker": "monaco-editor/esm/vs/editor/editor.worker.js",
    "ts.worker": "monaco-editor/esm/vs/language/typescript/ts.worker.js",
    "linter.worker": `${src}/linter.worker.ts`,
  },
  output: {
    path: `${dist}/ext/src`,
    filename(pathData, _assetInfo) {
      if (pathData.runtime === "ts.worker") {
        return "[name].js.bin";
      }
      return "[name].js";
    },
    clean: true,
  },
  resolve: {
    extensions: ["...", ".ts", ".tsx", ".jsx"],
    alias: {
      "@App": path.resolve(dirname, "src/"),
      "@Packages": path.resolve(dirname, "packages/"),
      // 改写eslint-plugin-userscripts以适配脚本猫，打包时重定义模块路径
      "../data/compat-grant": path.resolve(dirname, "packages/eslint/compat-grant"),
      "../data/compat-headers": path.resolve(dirname, "packages/eslint/compat-headers"),
    },
    fallback: {
      child_process: false,
    },
  },
  module: {
    rules: [
      {
        test: /\.css$/i,
        type: "css/auto",
        use: ["postcss-loader"],
      },
      {
        test: /\.(svg|png)$/,
        type: "asset",
      },
      {
        test: /\.(jsx?|tsx?)$/,
        use: [
          {
            loader: "builtin:swc-loader",
            options: {
              jsc: {
                externalHelpers: true,
                parser: {
                  syntax: "typescript",
                  tsx: true,
                  decorators: true,
                },
                transform: {
                  react: {
                    runtime: "automatic",
                    development: isDev,
                  },
                },
              },
              env: { targets },
            },
          },
        ],
      },
      {
        type: "asset/source",
        test: /\.tpl$/,
        exclude: /node_modules/,
      },
    ],
  },
  plugins: [
    new rspack.DefinePlugin({
      "process.env.VI_TESTING": "'false'",
      "process.env.SC_RANDOM_KEY": `'${uuidv4()}'`,
    }),
    new rspack.CopyRspackPlugin({
      patterns: [
        {
          from: `${src}/manifest.json`,
          to: `${dist}/ext`,
          // 将manifest.json内版本号替换为package.json中版本号
          transform(content: Buffer) {
            const manifest = JSON.parse(content.toString());
            if (isDev || isBeta) {
              manifest.name = "__MSG_scriptcat_beta__";
            }
            return JSON.stringify(manifest);
          },
        },
        {
          from: `${assets}/logo${isDev || isBeta ? "-beta" : ""}.png`,
          to: `${dist}/ext/assets/logo.png`,
        },
        {
          from: `${assets}/logo${isDev || isBeta ? "-beta" : ""}-32.png`,
          to: `${dist}/ext/assets/logo-32.png`,
        },
        { from: `${assets}/logo-gray.png`, to: `${dist}/ext/assets/logo-gray.png` },
        { from: `${assets}/logo-gray-32.png`, to: `${dist}/ext/assets/logo-gray-32.png` },
        { from: `${assets}/logo`, to: `${dist}/ext/assets/logo` },
        {
          from: `${assets}/_locales`,
          to: `${dist}/ext/_locales`,
        },
      ],
    }),
    new rspack.HtmlRspackPlugin({
      filename: `${dist}/ext/src/install.html`,
      template: `${src}/pages/template.html`,
      inject: "head",
      title: "Install - ScriptCat",
      minify: true,
      chunks: ["install"],
    }),
    new rspack.HtmlRspackPlugin({
      filename: `${dist}/ext/src/batchupdate.html`,
      template: `${src}/pages/template.html`,
      inject: "head",
      title: "BatchUpdate - ScriptCat",
      minify: true,
      chunks: ["batchupdate"],
    }),
    new rspack.HtmlRspackPlugin({
      filename: `${dist}/ext/src/confirm.html`,
      template: `${src}/pages/template.html`,
      inject: "head",
      title: "Confirm - ScriptCat",
      minify: true,
      chunks: ["confirm"],
    }),
    new rspack.HtmlRspackPlugin({
      filename: `${dist}/ext/src/import.html`,
      template: `${src}/pages/template.html`,
      inject: "head",
      title: "Import - ScriptCat",
      minify: true,
      chunks: ["import"],
    }),
    new rspack.HtmlRspackPlugin({
      filename: `${dist}/ext/src/options.html`,
      template: `${src}/pages/options.html`,
      inject: "head",
      title: "Home - ScriptCat",
      minify: true,
      chunks: ["options"],
    }),
    new rspack.HtmlRspackPlugin({
      filename: `${dist}/ext/src/popup.html`,
      template: `${src}/pages/popup.html`,
      inject: "head",
      title: "Home - ScriptCat",
      minify: true,
      chunks: ["popup"],
    }),
    new rspack.HtmlRspackPlugin({
      filename: `${dist}/ext/src/offscreen.html`,
      template: `${src}/pages/offscreen.html`,
      inject: "head",
      minify: true,
      chunks: ["offscreen"],
    }),
    new rspack.HtmlRspackPlugin({
      filename: `${dist}/ext/src/sandbox.html`,
      template: `${src}/pages/sandbox.html`,
      inject: "head",
      minify: true,
      chunks: ["sandbox"],
    }),
    new ZipExecutionPlugin(),
  ].filter(Boolean),
  experiments: {
    css: true,
    parallelCodeSplitting: true,
    parallelLoader: true,
  },
  optimization: {
    minimizer: [
      new rspack.SwcJsMinimizerRspackPlugin({
        test: /\.[cm]?js(\.bin)?(\?.*)?$/,
        minimizerOptions: {
          minify: !isDev,
          mangle: {
            keep_classnames: false,
            keep_fnames: false,
            keep_private_props: false,
            ie8: false,
            toplevel: true,
          },
          module: true,
          compress: {
            passes: 2,
            drop_console: false,
            drop_debugger: !isDev,
            ecma: 2022,
            arrows: true,
            dead_code: true,
            ie8: false,
            keep_classnames: false,
            keep_fargs: false,
            keep_fnames: false,
            toplevel: true,
            sequences: true,
            hoist_props: false,
            hoist_vars: false,
            reduce_funcs: true,
            reduce_vars: true,
            pure_getters: "strict",
          },
          format: {
            comments: false,
            beautify: false,
            ecma: 2022,
          },
        },
      }),
      new rspack.LightningCssMinimizerRspackPlugin({
        minimizerOptions: { targets },
      }),
    ],
    removeAvailableModules: true,
    removeEmptyChunks: true,
    realContentHash: true,
    sideEffects: true,
    providedExports: true,
    concatenateModules: true,
    avoidEntryIife: true,
    mergeDuplicateChunks: true,
    splitChunks: {
      minChunks: 1,
      maxAsyncRequests: 30,
      maxInitialRequests: 30,
      minSize: {
        javascript: 40 * 1024, // 40 kB
        css: 10 * 1024, // 10 kB
      },
      maxSize: {
        javascript: 2 * 1024 * 1024, // 2 MB
        css: 2 * 1024 * 1024, // 2 MB
      },
      chunks: (chunk) => !chunkExcludeSet.has(chunk.name || ""),
      hidePathInfo: false,
      name: (module, _ctx) => {
        if (module instanceof NormalModule) {
          const p = `/${module.rawRequest}|/${module.resource}`.toLowerCase().replace(/[\\@/]+/g, "/");
          if (p.startsWith("/packages/message/")) return "lib_message";
          if (module.type === "json" && p.includes("translation.json")) return "translation_json";
          let tag = "";
          const idx = p.indexOf("/node_modules/");
          if (idx >= 0) {
            let q = p.replace(/\.pnpm\/?/g, "");
            q = q.substring(idx);
            q = q.replace(/\..*/, "");
            tag = q.split("/")[2] || "";
          }
          if (module.type !== "css" && tag === "monaco-editor") return "lib_monaco";
          switch (tag) {
            case "react-icons":
              if (p.includes("/react-icons/tb")) return undefined;
            // eslint-disable-next-line no-fallthrough
            case "react-dropzone":
            case "react-dom":
            case "react-i18next":
            case "react-router-dom":
            case "react-joyride":
            case "react":
              return `lib_${tag}`;
          }
          if (tag.startsWith("dnd-kit")) return "lib_dnd-kit";
          if (tag.startsWith("popper")) return "lib_react-joyride";
          if (tag.startsWith("react-")) return "lib_react";
          if (tag.startsWith("eslint")) return "lib_eslint";
          if (tag.startsWith("i18n")) return "lib_i18n";
          if (
            tag.startsWith("arco-design") ||
            tag === "resize-observer-polyfill" ||
            tag === "b-validate" ||
            tag === "lodash" ||
            tag === "focus-lock"
          ) {
            return "lib_arco_design";
          }
          if (tag) {
            // cron, dayjs, yaml, jszip, prettier, ...
            if (tag === "luxon") return "lib_cron";
            return `lib_${tag}`;
          }
          return "chunk";
        }
      },
    },
  },
});
