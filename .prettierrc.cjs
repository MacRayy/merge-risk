module.exports = {
  printWidth: 100,
  tabWidth: 2,
  trailingComma: 'all',
  singleQuote: true,
  semi: false,
  overrides: [
    {
      files: ['*.ts', '*.js', '*.mjs', '*.cjs'],
      options: {
        plugins: ['@trivago/prettier-plugin-sort-imports'],
        importOrder: ['^[./]', '<THIRD_PARTY_MODULES>'],
        importOrderParserPlugins: ['typescript'],
        importOrderSeparation: true,
        importOrderSortSpecifiers: true,
        importOrderCaseInsensitive: true,
      },
    },
  ],
  proseWrap: 'always',
  endOfLine: 'lf',
}
