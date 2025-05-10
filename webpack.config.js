// webpack.config.js
const path = require("path");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const WebpackShellPluginNext = require('webpack-shell-plugin-next');

module.exports = (env, argv) => {
  const isProd = argv.mode === "production";

  return {
    entry: {
      styles: path.resolve(__dirname, "scss/main.scss"),
    },
    output: {
      path: path.resolve(__dirname, "dist"),
      filename: "[name].js", // we don’t actually output JS, but webpack requires it
      publicPath: "", // adjust if you serve from a sub‑folder
      assetModuleFilename: "fonts/[name][ext]",
    },
    module: {
      rules: [
        {
          test: /\.scss$/i,
          use: [
            MiniCssExtractPlugin.loader,
            {
              loader: "css-loader",
              options: { url: true, sourceMap: !isProd },
            },
            {
              loader: "postcss-loader",
              options: {
                postcssOptions: { plugins: ["autoprefixer"] },
                sourceMap: !isProd,
              },
            },
            {
              loader: "sass-loader",
              options: {
                sourceMap: !isProd,
                sassOptions: {
                  includePaths: [path.resolve(__dirname, "scss")],
                },
              },
            },
          ],
        },
        {
          test: /\.(ttf|woff2?|eot|svg)$/i,
          type: "asset/resource",
          generator: {
            filename: "fonts/[name][ext]",
          },
        },
        // (Optional) If you reference your pixel‑art PNGs via url(…):
        {
          test: /\.(png|jpg|jpeg|gif)$/i,
          type: "asset/resource",
          generator: {
            filename: "images/[name][ext]",
          },
        },
      ],
    },
    plugins: [
      new MiniCssExtractPlugin({
        filename: "styles.css",
      }),
      // run our script *before* webpack builds
      new WebpackShellPluginNext({
        onBuildStart: {
          scripts: [
            // adjust URL, flags, filters, colors, etc. as needed
            "node build/scripts/getimages.js " +
              "https://usetrmnl.com/css/latest/plugins.css " +
              "--base-url https://usetrmnl.com " +
              "--output images ",
          ],
          blocking: true,
          parallel: false,
        },
      }),
    ],
    devtool: isProd ? false : "source-map",
    resolve: {
      extensions: [".scss", ".css"],
    },
  };
};
