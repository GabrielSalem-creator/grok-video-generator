# Unlimited Video Generation Free Forever (iOS / Android)

Native shell that loads the live web app:

**https://video-generator-two-pied.vercel.app/**

inside a full-screen WebView, with camera / microphone / photo library permissions enabled for the site.

## App Store naming note

Apple limits the **App Store name to 30 characters**.  
Store display name used: **`Unlimited Video Gen Free`**  
Full brand used in description / keywords: **Unlimited Video Generation Free Forever**

## Local run

```bash
cd mobile
npm install
npx expo start
```

## EAS (cloud builds)

```bash
cd mobile
npx eas-cli login   # or set EXPO_TOKEN
npx eas init
npx eas build --platform ios --profile production
npx eas submit --platform ios --profile production
```

## What you still need for App Store release

1. **Apple Developer Program** membership ($99/year) — [developer.apple.com](https://developer.apple.com)
2. App Store Connect app created with bundle id `com.unlimitedvideogen.free`
3. EAS linked to your Apple team (EAS will prompt / use ASC API key)
4. Privacy policy URL (Apple requires this for camera/mic apps)
5. Screenshots for iPhone (6.7" and 6.1" recommended)

## Suggested App Store listing (SEO)

- **Name:** Unlimited Video Gen Free  
- **Subtitle:** AI cinematic videos, free forever  
- **Keywords:** ai video,text to video,image to video,free video generator,cinematic ai,grok video,ai movie  
- **Description (draft):**  
  Unlimited Video Generation Free Forever turns text prompts (and images) into cinematic AI videos. Create, preview, and download — free forever style generation inside a fast native shell.

## Security

Do **not** commit Expo tokens or Apple keys. Use `EXPO_TOKEN` in your environment only.
