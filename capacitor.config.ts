import type { CapacitorConfig } from '@capacitor/cli'

// The native iPhone and iPad app. It carries its own copy of the web app (dist/) so it opens
// instantly and works offline; it talks to the Cloudflare backend for sync and sharing.
const config: CapacitorConfig = {
  appId: 'app.plainsight.ios',
  appName: 'Plainsight',
  webDir: 'dist',
  backgroundColor: '#f6f3f9',
  ios: {
    contentInset: 'never',
    scheme: 'Plainsight',
  },
}

export default config
