import prettierConfig from "@iobroker/eslint-config/prettier.config.mjs";

export default {
  ...prettierConfig,
  printWidth: 80,
  tabWidth: 2,
  singleQuote: false,
  arrowParens: "always",
  singleAttributePerLine: false,
};
