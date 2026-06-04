/**
 * Súbor: app/(tabs)/account.tsx
 * Abstrakt: Spravuje obrazovku účtu, profil používateľa, zmenu hesla a odhlásenie.
 */
import React, { useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, Alert, ActivityIndicator } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTranslation } from "@/src/lang/LanguagePreference";
import { useAuth } from "@/src/auth/AuthProvider";
import { getMyProfile, upsertMyUsername } from "@/src/storage/profileRepo";

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export default function AccountScreen() {
  const { user, loading, signOut, changePassword } = useAuth();
  const { t } = useTranslation();
  const colorScheme = useColorScheme() ?? "light";
  const isDark = colorScheme === "dark";
  const userId = user?.id ?? null;

  const [profileLoading, setProfileLoading] = useState(false);

  const [username, setUsername] = useState("");
  const [savingUsername, setSavingUsername] = useState(false);

  const [newPass, setNewPass] = useState("");
  const [newPass2, setNewPass2] = useState("");
  const [savingPass, setSavingPass] = useState(false);

  useEffect(() => {
    if (!userId) return;
    (async () => {
      try {
        setProfileLoading(true);
        const p = await getMyProfile();
        setUsername(p?.username ?? "");
      } catch (error: unknown) {
        Alert.alert(t("account.profileError"), getErrorMessage(error, t("account.failedLoadProfile")));
      } finally {
        setProfileLoading(false);
      }
    })();
  }, [t, userId]);

  useFocusEffect(
    React.useCallback(() => {
      if (loading) return;
      if (!user) router.replace("/(auth)/login");
    }, [loading, user])
  );

  if (loading) {
    return (
      <View style={[s.root, isDark && s.rootDark, { justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator />
        <Text style={{ marginTop: 10, color: isDark ? "#94a3b8" : "#64748b", fontWeight: "700" }}>{t("account.loadingSession")}</Text>
      </View>
    );
  }

  if (!user) return null;

  const onSaveUsername = async () => {
    try {
      setSavingUsername(true);
      await upsertMyUsername(username);
      Alert.alert(t("account.saved"), t("account.usernameUpdated"));
    } catch (error: unknown) {
      Alert.alert(t("account.saveError"), getErrorMessage(error, t("account.failedSaveUsername")));
    } finally {
      setSavingUsername(false);
    }
  };

  const onChangePassword = async () => {
    const a = newPass.trim();
    const b = newPass2.trim();

    if (a.length < 6) {
      Alert.alert(t("account.password"), t("account.min6"));
      return;
    }
    if (a !== b) {
      Alert.alert(t("account.password"), t("account.passwordsMismatch"));
      return;
    }

    try {
      setSavingPass(true);
      await changePassword(a);
      setNewPass("");
      setNewPass2("");
      Alert.alert(t("common.done"), t("account.passwordUpdated"));
    } catch (error: unknown) {
      Alert.alert(t("account.passwordError"), getErrorMessage(error, t("account.failedUpdatePassword")));
    } finally {
      setSavingPass(false);
    }
  };

  const onLogout = async () => {
    try {
      await signOut();
      router.replace("/(auth)/login");
    } catch (error: unknown) {
      Alert.alert(t("account.logoutError"), getErrorMessage(error, t("account.failedLogout")));
    }
  };

  return (
    <View style={[s.root, isDark && s.rootDark]}>
      <Text style={[s.h1, isDark && s.h1Dark]}>{t("account.title")}</Text>

      <View style={[s.card, isDark && s.cardDark]}>
        <Text style={[s.label, isDark && s.labelDark]}>{t("account.email")}</Text>
        <Text style={[s.value, isDark && s.valueDark]}>{user.email ?? "—"}</Text>
      </View>

      <View style={[s.card, isDark && s.cardDark]}>
        <Text style={[s.label, isDark && s.labelDark]}>{t("account.username")}</Text>
        <TextInput
          value={username}
          onChangeText={setUsername}
          placeholder={t("account.yourUsername")}
          placeholderTextColor={isDark ? "#94a3b8" : "#9ca3af"}
          autoCapitalize="none"
          style={[s.input, isDark && s.inputDark]}
        />

        <Pressable
          onPress={onSaveUsername}
          disabled={savingUsername || profileLoading}
          style={({ pressed }) => [
            s.btn,
            pressed && s.pressed,
            (savingUsername || profileLoading) && s.disabled,
          ]}
        >
          <Text style={s.btnText}>
            {savingUsername ? "..." : profileLoading ? t("common.loading") : t("account.saveUsername")}
          </Text>
        </Pressable>
      </View>

      <View style={[s.card, isDark && s.cardDark]}>
        <Text style={[s.label, isDark && s.labelDark]}>{t("account.changePassword")}</Text>

        <TextInput
          value={newPass}
          onChangeText={setNewPass}
          placeholder={t("account.newPassword")}
          secureTextEntry
          placeholderTextColor={isDark ? "#94a3b8" : "#9ca3af"}
          style={[s.input, isDark && s.inputDark]}
        />
        <TextInput
          value={newPass2}
          onChangeText={setNewPass2}
          placeholder={t("account.repeatNewPassword")}
          secureTextEntry
          placeholderTextColor={isDark ? "#94a3b8" : "#9ca3af"}
          style={[s.input, isDark && s.inputDark]}
        />

        <Pressable
          onPress={onChangePassword}
          disabled={savingPass}
          style={({ pressed }) => [s.btn, pressed && s.pressed, savingPass && s.disabled]}
        >
          <Text style={s.btnText}>{savingPass ? "..." : t("account.updatePassword")}</Text>
        </Pressable>
      </View>

      <Pressable onPress={onLogout} style={({ pressed }) => [s.logout, isDark && s.logoutDark, pressed && s.pressed]}>
        <Text style={s.logoutText}>{t("account.logOut")}</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, padding: 16, paddingTop: 36, gap: 12, backgroundColor: "#fff" },
  rootDark: { backgroundColor: "#0f172a" },
  h1: { fontSize: 24, fontWeight: "900", color: "#111827", marginBottom: 4 },
  h1Dark: { color: "#f8fafc" },
  card: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 14,
    padding: 12,
    gap: 10,
    backgroundColor: "#f8fafc",
  },
  cardDark: { borderColor: "#334155", backgroundColor: "#111827" },
  label: { color: "#64748b", fontWeight: "800", fontSize: 12 },
  labelDark: { color: "#94a3b8" },
  value: { color: "#111827", fontWeight: "800", fontSize: 14 },
  valueDark: { color: "#f8fafc" },
  input: {
    height: 44,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: "#fff",
    color: "#111827",
  },
  inputDark: { borderColor: "#334155", backgroundColor: "#0b1220", color: "#f8fafc" },
  btn: {
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0ea5e9",
  },
  btnText: { color: "#fff", fontWeight: "900" },
  logout: {
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#ef4444",
    backgroundColor: "#fff",
    marginTop: 8,
  },
  logoutDark: { borderColor: "#f87171", backgroundColor: "#111827" },
  logoutText: { color: "#ef4444", fontWeight: "900" },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.6 },
});
