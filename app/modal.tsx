/**
 * Súbor: app/modal.tsx
 * Abstrakt: Obsahuje jednoduchú modálnu obrazovku používanú routerom aplikácie.
 */
import { Redirect } from "expo-router";

export default function ModalScreen() {
  return <Redirect href="/(tabs)/create" />;
}
