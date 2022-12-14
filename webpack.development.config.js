const path = require("path");

module.exports = {
  mode: "development",
  entry: "./src/index.js",
  output: {
    path: path.resolve(__dirname, "./dist"),
    filename: "alanngai-oss-wx-uploader.js",
    libraryTarget: "umd",
    globalObject: "this",
    // libraryExport: 'default',
    library: "alanngai-oss-wx-uploader",
  },
  module: {
    // rules: [
    //   {
    //     test: /\.(js)$/,
    //     exclude: /node_modules/,
    //     use: {
    //       loader: "babel-loader",
    //       options: {
    //         presets: ["@babel/preset-env"],
    //         plugins: [
    //           "@babel/plugin-transform-runtime",
    //           "@babel/plugin-proposal-object-rest-spread",
    //         ],
    //       },
    //     },
    //   },
    // ],
  },
  devtool: "source-map",
};
