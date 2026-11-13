import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  // keep both the standard and the -webkit- form of properties such as backdrop-filter (older iPhones need the prefix)
  build: { cssTarget: ['chrome100', 'safari15', 'firefox100'] },
})
