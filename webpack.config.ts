/* eslint-disable import/no-extraneous-dependencies */
import path from "path";
import type { Configuration } from "webpack";
import TerserPlugin from "terser-webpack-plugin";
import HtmlWebpackPlugin from "html-webpack-plugin";
import ESLintPlugin from "eslint-webpack-plugin";
import CopyPlugin from "copy-webpack-plugin";
import { CleanWebpackPlugin } from "clean-webpack-plugin";
import ProgressBarPlugin from "progress-bar-webpack-plugin";
import MonacoLocalesPlugin from "monaco-editor-locales-plugin";

// ✂️ Import presets from the core package:
import { presetAttributify, presetUno } from "unocss";

const src = path.resolve(__dirname, "src");
const dist = path.resolve(__dirname, "dist");
const assets = path.resolve(__dirname, "build/assets");
const template = path.resolve(assets, "template");

// Export an async function so we can dynamically import the ESM-only plugin:
export default async function (): Promise<Configuration> {
  // Dynamically import the Webpack plugin (ESM-only in v0.59+)
  const { default: UnoCSS } = await import("@unocss/webpack");

  return {
    entry: {
      options: `${src}/pages/options/main.tsx`,
      install: `${src}/pages/install/main.tsx`,
      background: `${src}/background.ts`,
      sandbox: `${src}/sandbox.ts`,
      popup: `${src}/pages/popup/main.tsx`,
      confirm: `${src}/pages/confirm/main.tsx`,
      import: `${src}/pages/import/main.tsx`,
    },
    output: {
      path: `${dist}/ext/src`,
      filename: "[name].js",
      clean: true,
    },
    plugins: [
      // — your existing HtmlWebpackPlugin instances …
      new HtmlWebpackPlugin({
        filename: `${dist}/ext/src/options.html`,
        template: `${template}/options.html`,
        inject: "head",
        title: "Home - ScriptCat",
        minify: { removeComments: true },
        chunks: ["options"],
      }),
      // … (other HtmlWebpackPlugin calls) …
      new ESLintPlugin({ extensions: [".ts", ".tsx"] }),
      new CopyPlugin({
        patterns: [
          { from: `${assets}/_locales`, to: `${dist}/ext/_locales` },
          { from: `${assets}/logo`,    to: `${dist}/ext/assets/logo` },
        ],
      }),
      new CleanWebpackPlugin(),
      new ProgressBarPlugin(),
      new MonacoLocalesPlugin({
        languages: ["es", "zh-cn"],
        defaultLanguage: "zh-cn",
        logUnmatched: false,
      }),

      // — the UnoCSS plugin, called as a factory:
      UnoCSS({
        presets: [
          presetUno(),
          presetAttributify(),
        ],
      }),
    ],
    resolve: {
      extensions: [".js", ".ts", ".tsx", ".d.ts", ".tpl", ".json"],
      alias: {
        "@App": path.resolve(__dirname, "src/"),
        "@Pkg": path.resolve(__dirname, "pkg/"),
      },
    },
    module: {
      rules: [
        { test: /\.(ts|tsx)$/, use: ["babel-loader"], exclude: /node_modules/ },
        { test: /\.css$/,     use: ["style-loader", "css-loader"] },
        { test: /\.d\.ts$/,   use: ["raw-loader"], include: src },
        { test: /inject\.js$/, use: ["raw-loader"], include: /dist/ },
        { test: /\.tpl$/,     use: ["raw-loader"], exclude: /node_modules/ },
      ],
    },
    optimization: {
      minimize: true,
      minimizer: [new TerserPlugin()],
      splitChunks: {
        chunks: "all",
        minSize: 307_200,
        maxSize: 4_194_304,
        cacheGroups: {
          monaco: {
            test: /[\\/]node_modules[\\/]monaco-editor/,
            minSize: 307_200,
            maxSize: 4_194_304,
            name: "monaco",
            priority: 1,
            reuseExistingChunk: true,
          },
          vendor: {
            test: /[\\/]node_modules[\\/]/,
            minSize: 307_200,
            maxSize: 4_194_304,
            name: "vendor",
            priority: 0,
            reuseExistingChunk: true,
          },
        },
      },
    },
  };
}
