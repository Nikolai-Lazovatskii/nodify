import React, { useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, Alert, ActivityIndicator } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useAuth } from "@/src/auth/AuthProvider";
import { getMyProfile, upsertMyUsername } from "@/src/storage/profileRepo";

export default function AccountScreen() {
  const { user, loading, signOut, changePassword } = useAuth();

  const [profileLoading, setProfileLoading] = useState(false);

  const [username, setUsername] = useState("");
  const [savingUsername, setSavingUsername] = useState(false);

  const [newPass, setNewPass] = useState("");
  const [newPass2, setNewPass2] = useState("");
  const [savingPass, setSavingPass] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        setProfileLoading(true);
        const p = await getMyProfile();
        setUsername(p?.username ?? "");
      } catch (e: any) {
        Alert.alert("Profile error", e?.message ?? "Failed to load profile");
      } finally {
        setProfileLoading(false);
      }
    })();
  }, [user?.id]);

  useFocusEffect(
    React.useCallback(() => {
      if (loading) return;
      if (!user) router.replace("/(auth)/login");
    }, [loading, user])
  );

  if (loading) {
    return (
      <View style={[s.root, { justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator />
        <Text style={{ marginTop: 10, color: "#64748b", fontWeight: "700" }}>Loading session…</Text>
      </View>
    );
  }

  if (!user) return null;

  const onSaveUsername = async () => {
    try {
      setSavingUsername(true);
      await upsertMyUsername(username);
      Alert.alert("Saved", "Username updated");
    } catch (e: any) {
      Alert.alert("Save error", e?.message ?? "Failed to save username");
    } finally {
      setSavingUsername(false);
    }
  };

  const onChangePassword = async () => {
    const a = newPass.trim();
    const b = newPass2.trim();

    if (a.length < 6) {
      Alert.alert("Password", "Minimum 6 characters");
      return;
    }
    if (a !== b) {
      Alert.alert("Password", "Passwords do not match");
      return;
    }

    try {
      setSavingPass(true);
      await changePassword(a);
      setNewPass("");
      setNewPass2("");
      Alert.alert("Done", "Password updated");
    } catch (e: any) {
      Alert.alert("Password error", e?.message ?? "Failed to update password");
    } finally {
      setSavingPass(false);
    }
  };

  const onLogout = async () => {
    await signOut();
    router.replace("/(auth)/login");
  };

  return (
    <View style={s.root}>
      <Text style={s.h1}>Account</Text>

      <View style={s.card}>
        <Text style={s.label}>Email</Text>
        <Text style={s.value}>{user.email ?? "—"}</Text>
      </View>

      <View style={s.card}>
        <Text style={s.label}>Username</Text>
        <TextInput
          value={username}
          onChangeText={setUsername}
          placeholder="Your username"
          autoCapitalize="none"
          style={s.input}
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
            {savingUsername ? "..." : profileLoading ? "Loading..." : "Save username"}
          </Text>
        </Pressable>
      </View>

      <View style={s.card}>
        <Text style={s.label}>Change password</Text>

        <TextInput
          value={newPass}
          onChangeText={setNewPass}
          placeholder="New password"
          secureTextEntry
          style={s.input}
        />
        <TextInput
          value={newPass2}
          onChangeText={setNewPass2}
          placeholder="Repeat new password"
          secureTextEntry
          style={s.input}
        />

        <Pressable
          onPress={onChangePassword}
          disabled={savingPass}
          style={({ pressed }) => [s.btn, pressed && s.pressed, savingPass && s.disabled]}
        >
          <Text style={s.btnText}>{savingPass ? "..." : "Update password"}</Text>
        </Pressable>
      </View>

      <Pressable onPress={onLogout} style={({ pressed }) => [s.logout, pressed && s.pressed]}>
        <Text style={s.logoutText}>Log out</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, padding: 16, paddingTop: 36, gap: 12, backgroundColor: "#fff" },
  h1: { fontSize: 24, fontWeight: "900", color: "#111827", marginBottom: 4 },
  card: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 14,
    padding: 12,
    gap: 10,
    backgroundColor: "#f8fafc",
  },
  label: { color: "#64748b", fontWeight: "800", fontSize: 12 },
  value: { color: "#111827", fontWeight: "800", fontSize: 14 },
  input: {
    height: 44,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: "#fff",
  },
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
  logoutText: { color: "#ef4444", fontWeight: "900" },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.6 },
});