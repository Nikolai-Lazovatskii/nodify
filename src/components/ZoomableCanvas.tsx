import React, { PropsWithChildren } from "react";
import { StyleSheet, View } from "react-native";
import Zoom from "react-native-zoom-reanimated";

type Props = PropsWithChildren<{}>;

export default function ZoomableCanvas({ children }: Props) {
  return (
    <Zoom style={styles.container}>
      <View style={styles.inner}>{children}</View>
    </Zoom>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  inner: {
    flex: 1,
    minWidth: "100%",
    minHeight: "100%",
  },
});