export default {
  '**/*.{ts,tsx,vue}': ['eslint --fix --max-warnings=0', 'prettier --write'],
  '**/*.{json,yaml,yml,css,html,md}': ['prettier --write'],
}
