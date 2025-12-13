import React, { useState } from "react";
import { View, TextInput, StyleSheet, TouchableOpacity } from "react-native";
import { Circle, Text as SvgText } from "react-native-svg";
import { MindMapNode } from "../types/map";

type Props = {
  node: MindMapNode;
  isRoot?: boolean;
  onUpdateTitle: (nodeId: string, newTitle: string) => void;
};

export default function EditableNodeView({
  node,
  isRoot = false,
  onUpdateTitle,
}: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(node.title);

  const radius = isRoot ? 26 : 20;
  const fill = isRoot ? "#38bdf8" : "#e5e7eb";

  const handlePress = () => {
    setIsEditing(true);
  };

  const handleSubmit = () => {
    const newTitle = draft.trim() || node.title;
    onUpdateTitle(node.id, newTitle);
    setIsEditing(false);
  };

  return (
    <>
      <Circle cx={node.x} cy={node.y} r={radius} fill={fill} />
      {isEditing ? (
        <View style={[styles.inputWrapper, { left: node.x - radius, top: node.y - radius }]}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={handleSubmit}
            onBlur={handleSubmit}
            autoFocus
          />
        </View>
      ) : (
        <TouchableOpacity onPress={handlePress} activeOpacity={0.7}>
          <SvgText
            x={node.x}
            y={node.y + 4}
            fontSize={isRoot ? 14 : 12}
            fill="#111827"
            textAnchor="middle"
          >
            {node.title}
          </SvgText>
        </TouchableOpacity>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  inputWrapper: {
    position: "absolute",
    width: 120,
    height: 30,
    backgroundColor: "white",
    justifyContent: "center",
    alignItems: "center",
  },
  input: {
    fontSize: 14,
    padding: 0,
    margin: 0,
    width: "100%",
    textAlign: "center",
  },
});