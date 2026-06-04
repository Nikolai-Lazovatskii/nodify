/**
 * Súbor: app/(auth)/login.tsx
 * Abstrakt: Zobrazuje prihlasovací formulár a odosiela prihlasovacie údaje cez autentifikačný kontext.
 */
import React, { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet } from "react-native";
import { Link, router, Href } from "expo-router";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTranslation } from "@/src/lang/LanguagePreference";
import { useAuth } from "@/src/auth/AuthProvider";

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export default function LoginScreen() {
  const { signIn } = useAuth();
  const { t } = useTranslation();
  const colorScheme = useColorScheme() ?? "light";
  const isDark = colorScheme === "dark";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async () => {
    setErr(null);
    setBusy(true);
    try {
      await signIn(email.trim(), password);
      router.replace("/(tabs)/account");
    } catch (error: unknown) {
      setErr(getErrorMessage(error, t("auth.loginFailed")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[s.root, isDark && s.rootDark]}>
      <Text style={[s.h1, isDark && s.h1Dark]}>{t("auth.loginTitle")}</Text>

      <TextInput
        style={[s.input, isDark && s.inputDark]}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        placeholder={t("auth.email")}
        placeholderTextColor={isDark ? "#94a3b8" : "#9ca3af"}
      />
      <TextInput
        style={[s.input, isDark && s.inputDark]}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        placeholder={t("auth.password")}
        placeholderTextColor={isDark ? "#94a3b8" : "#9ca3af"}
      />

      {err ? <Text style={s.err}>{err}</Text> : null}

      <Pressable style={({ pressed }) => [s.btn, pressed && s.pressed]} onPress={onSubmit} disabled={busy}>
        <Text style={s.btnText}>{busy ? "..." : t("auth.signIn")}</Text>
      </Pressable>

      <Text style={[s.small, isDark && s.smallDark]}>
        {t("auth.noAccount")} <Link href={"/(auth)/register" as Href}>{t("auth.createOne")}</Link>
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, padding: 20, justifyContent: "center", gap: 12, backgroundColor: "#fff" },
  rootDark: { backgroundColor: "#0f172a" },
  h1: { fontSize: 24, fontWeight: "900", color: "#111827", marginBottom: 8 },
  h1Dark: { color: "#f8fafc" },
  input: {
    height: 44,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    paddingHorizontal: 12,
    color: "#111827",
    backgroundColor: "#ffffff",
  },
  inputDark: { borderColor: "#334155", color: "#f8fafc", backgroundColor: "#111827" },
  btn: { height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#0ea5e9" },
  btnText: { color: "#fff", fontWeight: "900" },
  pressed: { opacity: 0.85 },
  err: { color: "#ef4444", fontWeight: "700" },
  small: { marginTop: 6, color: "#64748b" },
  smallDark: { color: "#94a3b8" },
});
