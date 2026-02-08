import React, { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet } from "react-native";
import { Link, router, Href } from "expo-router";
import { useAuth } from "@/src/auth/AuthProvider";

export default function LoginScreen() {
  const { signIn } = useAuth();
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
    } catch (e: any) {
      setErr(e?.message ?? "Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={s.root}>
      <Text style={s.h1}>Login</Text>

      <TextInput
        style={s.input}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        placeholder="Email"
      />
      <TextInput
        style={s.input}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        placeholder="Password"
      />

      {err ? <Text style={s.err}>{err}</Text> : null}

      <Pressable style={({ pressed }) => [s.btn, pressed && s.pressed]} onPress={onSubmit} disabled={busy}>
        <Text style={s.btnText}>{busy ? "..." : "Sign in"}</Text>
      </Pressable>

      <Text style={s.small}>
        No account? <Link href={"/(auth)/register" as Href}>Create one</Link>
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, padding: 20, justifyContent: "center", gap: 12, backgroundColor: "#fff" },
  h1: { fontSize: 24, fontWeight: "900", color: "#111827", marginBottom: 8 },
  input: { height: 44, borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 12, paddingHorizontal: 12 },
  btn: { height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#0ea5e9" },
  btnText: { color: "#fff", fontWeight: "900" },
  pressed: { opacity: 0.85 },
  err: { color: "#ef4444", fontWeight: "700" },
  small: { marginTop: 6, color: "#64748b" },
});