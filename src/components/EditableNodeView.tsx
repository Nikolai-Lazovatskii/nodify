import React, { useEffect, useState } from "react";
import { View, TextInput, StyleSheet } from "react-native";
import { Circle, Text as SvgText, G } from "react-native-svg";
import { MindMapNode } from "../types/map";

type Props = {
  node: MindMapNode;
  isRoot?: boolean;
  selected?: boolean;
  onSelect?: (nodeId: string) => void;
  onUpdateTitle: (nodeId: string, newTitle: string) => void;
};

export default function EditableNodeView({
  node,
  isRoot = false,
  selected = false,
  onSelect,
  onUpdateTitle,
}: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(node.title);

  useEffect(() => {
    if (!isEditing) setDraft(node.title);
  }, [node.title, isEditing]);

  const radius = isRoot ? 26 : 20;
  const fill = isRoot ? "#38bdf8" : "#e5e7eb";

  const stroke = selected ? "#0ea5e9" : "transparent";
  const strokeWidth = selected ? 3 : 0;

  const handlePress = () => {
    onSelect?.(node.id);
    setIsEditing(true);
  };

  const handleSelectOnly = () => {
    onSelect?.(node.id);
  };

  const handleSubmit = () => {
    const newTitle = draft.trim() || node.title;
    onUpdateTitle(node.id, newTitle);
    setIsEditing(false);
  };

  return (
    <>
      <G>
        <Circle
          cx={node.x}
          cy={node.y}
          r={radius}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          onPress={handleSelectOnly}
        />

        {!isEditing && (
          <SvgText
            x={node.x}
            y={node.y + 4}
            fontSize={isRoot ? 14 : 12}
            fill="#111827"
            textAnchor="middle"
            onPress={handlePress}
          >
            {node.title}
          </SvgText>
        )}
      </G>

      {isEditing && (
        <View
          style={[
            styles.inputWrapper,
            { left: node.x - 60, top: node.y - 15 },
          ]}
        >
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={handleSubmit}
            onBlur={handleSubmit}
            autoFocus
          />
        </View>
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