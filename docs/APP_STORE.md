# Getting Plainsight into the App Store (from an iPad, no Mac)

Codemagic builds the app on its Macs from this GitHub repository and uploads it to App Store Connect.
Everything below is done in Safari on the iPad. Allow about an hour the first time.

## 1. Register the app ID (Apple Developer website)

1. Open developer.apple.com/account and sign in.
2. **Certificates, IDs & Profiles**, then **Identifiers**, then **+**.
3. Choose **App IDs**, then **App**.
4. Description: `Plainsight`. Bundle ID: **Explicit**, `app.plainsight.ios`.
5. Continue, then Register. (No extra capabilities are needed.)

## 2. Create the app (App Store Connect)

1. Open appstoreconnect.apple.com, **Apps**, then **+**, **New App**.
2. Platform **iOS**. Name `Plainsight` (if it is taken, use `Plainsight: Life Board`).
3. Primary language, bundle ID `app.plainsight.ios`, SKU `plainsight`, full access.

## 3. Make an API key for Codemagic (App Store Connect)

1. **Users and Access**, then **Integrations**, then **App Store Connect API**, **Team Keys**.
2. **Generate API Key**. Name `Codemagic`, access **App Manager**.
3. Note the **Issuer ID** and the **Key ID**. Tap **Download** next to the key: it saves a `.p8` file to Files.
   Apple lets you download it only once, so keep it.

## 4. Set up Codemagic

1. Open codemagic.io and sign up with your GitHub account. Allow it to see the `plan-app` repository.
2. **Add application**, choose `plan-app`, project type **Other** (it reads `codemagic.yaml`).
3. **Team settings** (or your user settings), **Integrations**, **Developer Portal**, **Connect**.
   - Name it exactly `Plainsight`.
   - Paste the Issuer ID and Key ID, and choose the `.p8` file from Files.
4. Start a new build: branch `claude/intelligent-hypatia-yg0dl6`, workflow **Plainsight for iPhone and iPad**.

The build takes about 15 minutes. When it finishes, the app appears in App Store Connect under **TestFlight**
(Apple takes a few more minutes to process it). Install the **TestFlight** app on your iPhone to try it.

If a build fails, copy the red error line from the Codemagic log and send it to Claude.

## 5. Fill in the App Store page and submit

In App Store Connect, open the app and the version **1.0**:

- **Screenshots**: upload the files in `store/screenshots/`
  (`iphone-*` into the 6.9-inch iPhone slot, `ipad-*` into the 13-inch iPad slot).
- **Text**: copy from `store/listing.md`.
- **Support URL** and **Privacy Policy URL**: the live site's `/support.html` and `/privacy.html`.
- **App Privacy**: answer as in `store/listing.md`.
- **Build**: choose the one from TestFlight.
- **Submit for Review**. Apple usually replies within one to two days.
