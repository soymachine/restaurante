import { defineConfig } from 'astro/config';

// GitHub Pages deploy: https://soymachine.github.io/restaurante/
export default defineConfig({
  site: 'https://soymachine.github.io',
  base: '/restaurante/',
  trailingSlash: 'ignore',
  build: {
    assets: 'assets',
  },
});
