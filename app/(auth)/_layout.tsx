/**
 * Súbor: app/(auth)/_layout.tsx
 * Abstrakt: Definuje rozloženie autentifikačných obrazoviek a spoločný navigačný zásobník.
 */
import { Stack } from "expo-router";

export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
