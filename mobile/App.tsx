import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { WebView, type WebViewNavigation } from "react-native-webview";

SplashScreen.preventAutoHideAsync().catch(() => undefined);

const WEB_APP_URL = "https://video-generator-two-pied.vercel.app/";

export default function App() {
  const webRef = useRef<WebView>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
    SplashScreen.hideAsync().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (canGoBack && webRef.current) {
        webRef.current.goBack();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [canGoBack]);

  const onNavChange = useCallback((nav: WebViewNavigation) => {
    setCanGoBack(nav.canGoBack);
  }, []);

  const reload = useCallback(() => {
    setError(null);
    setLoading(true);
    webRef.current?.reload();
  }, []);

  if (!ready) {
    return <View style={styles.boot} />;
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <View style={styles.container}>
        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorTitle}>Couldn’t load the app</Text>
            <Text style={styles.errorBody}>{error}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={reload}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <WebView
            ref={webRef}
            source={{ uri: WEB_APP_URL }}
            style={styles.webview}
            onNavigationStateChange={onNavChange}
            onLoadStart={() => setLoading(true)}
            onLoadEnd={() => setLoading(false)}
            onError={(e) => {
              setLoading(false);
              setError(e.nativeEvent.description || "Network error");
            }}
            onHttpError={(e) => {
              if (e.nativeEvent.statusCode >= 500) {
                setError(`Server error (${e.nativeEvent.statusCode})`);
              }
            }}
            // Media / camera / mic for the embedded website
            mediaPlaybackRequiresUserAction={false}
            allowsInlineMediaPlayback
            allowsFullscreenVideo
            javaScriptEnabled
            domStorageEnabled
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            startInLoadingState
            setSupportMultipleWindows={false}
            originWhitelist={["*"]}
            allowsBackForwardNavigationGestures
            // iOS 15+: auto-grant getUserMedia / capture prompts from the page
            mediaCapturePermissionGrantType="grant"
            // Android camera/mic permission bridge
            {...(Platform.OS === "android"
              ? {
                  mixedContentMode: "compatibility" as const,
                  geolocationEnabled: false,
                }
              : {})}
          />
        )}

        {loading && !error ? (
          <View style={styles.loadingOverlay} pointerEvents="none">
            <ActivityIndicator size="large" color="#ffffff" />
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  boot: { flex: 1, backgroundColor: "#000000" },
  safe: { flex: 1, backgroundColor: "#000000" },
  container: { flex: 1, backgroundColor: "#000000" },
  webview: { flex: 1, backgroundColor: "#000000" },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  errorBox: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    gap: 12,
  },
  errorTitle: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
  },
  errorBody: {
    color: "#a3a3a3",
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  retryBtn: {
    marginTop: 8,
    backgroundColor: "#ffffff",
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 999,
  },
  retryText: {
    color: "#000000",
    fontWeight: "700",
    fontSize: 15,
  },
});
