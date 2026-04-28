import { useThemePreference } from "@/src/theme/ThemePreference";

export function useColorScheme() {
  return useThemePreference().colorScheme;
}
