import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Keyboard,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { File } from "expo-file-system";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTranslation } from "@/src/i18n/LanguagePreference";

import { EdgeStyle, MindMapNode, NodeAttachment, NodeShape, RelationshipEdge } from "../types/map";

type Props = {
  node: MindMapNode | null;
  nodes: Record<string, MindMapNode>;
  edges: RelationshipEdge[];
  onClose: () => void;
  onUpdateTitle: (nodeId: string, newTitle: string) => void;
  onUpdateNote: (nodeId: string, note: string | undefined) => void;
  onUpdateTags: (nodeId: string, tags: string[]) => void;
  onUpdateDueAt: (nodeId: string, dueAt: string | undefined) => void;
  onAddAttachment: (nodeId: string, attachment: NodeAttachment) => void;
  onRemoveAttachment: (nodeId: string, attachmentId: string) => void;
  onUpdateCollapsed: (nodeId: string, collapsed: boolean) => void;
  onUpdateColor: (nodeId: string, color: string | undefined) => void;
  onUpdateSize?: (nodeId: string, size: number) => void;
  onHeight: (height: number) => void;
  onSelectNode: (nodeId: string) => void;
  onDeleteConnection?: (nodeId: string, connectedNodeId: string) => void;
  onDeleteNode?: (nodeId: string) => void;
  sideWidth?: number;
  mode?: "sheet" | "side";
  onUpdateShape?: (nodeId: string, shape: NodeShape | undefined) => void;
  onUpdateEdge?: (nodeId: string, patch: { style?: EdgeStyle; width?: number; color?: string }) => void;
};

const PALETTE = [
  "#38bdf8",
  "#22c55e",
  "#a855f7",
  "#f97316",
  "#ef4444",
  "#facc15",
  "#94a3b8",
  "#e5e7eb",
];

export default function NodeInspector({
  node,
  nodes,
  edges,
  onClose,
  onUpdateTitle,
  onUpdateNote,
  onUpdateTags,
  onUpdateDueAt,
  onAddAttachment,
  onRemoveAttachment,
  onUpdateCollapsed,
  onUpdateColor,
  onUpdateSize,
  onHeight,
  onSelectNode,
  onDeleteConnection,
  onDeleteNode,
  sideWidth,
  mode,
  onUpdateShape,
  onUpdateEdge,
}: Props) {
  const { t } = useTranslation();
  const colorScheme = useColorScheme() ?? "light";
  const isDark = colorScheme === "dark";
  const panelMode = mode ?? "sheet";
  const isSide = panelMode === "side";
  const panelWidth = sideWidth ?? 340;
  const [draft, setDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [tagsDraft, setTagsDraft] = useState("");
  const [dateDraft, setDateDraft] = useState("");
  const [timeDraft, setTimeDraft] = useState("");

  const formatDateDraft = (date: Date) => {
    const day = `${date.getDate()}`.padStart(2, "0");
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const year = `${date.getFullYear()}`;
    return `${day}.${month}.${year}`;
  };

  useEffect(() => {
    setDraft(node?.title ?? "");
    setNoteDraft(node?.note ?? "");
    setTagsDraft((node?.tags ?? []).join(", "));
    const dueDate = node?.dueAt ? new Date(node.dueAt) : null;
    if (dueDate && !Number.isNaN(dueDate.getTime())) {
      const hour = `${dueDate.getHours()}`.padStart(2, "0");
      const minute = `${dueDate.getMinutes()}`.padStart(2, "0");
      setDateDraft(formatDateDraft(dueDate));
      setTimeDraft(`${hour}:${minute}`);
    } else {
      setDateDraft("");
      setTimeDraft("");
    }
  }, [node?.dueAt, node?.id, node?.note, node?.tags, node?.title]);

  const parent = useMemo(() => {
    if (!node?.parentId) {
      return null;
    }

    return nodes[node.parentId] ?? null;
  }, [node?.parentId, nodes]);

  const children = useMemo(() => {
    if (!node) {
      return [];
    }

    return node.children.map((childId) => nodes[childId]).filter(Boolean) as MindMapNode[];
  }, [node, nodes]);

  const connections = useMemo(() => {
    if (!node) {
      return [];
    }

    const connectionIds = new Set<string>();

    for (const edge of edges) {
      if (edge.fromId === node.id && edge.toId !== node.id) {
        connectionIds.add(edge.toId);
      }

      if (edge.toId === node.id && edge.fromId !== node.id) {
        connectionIds.add(edge.fromId);
      }
    }

    return Array.from(connectionIds)
      .map((id) => nodes[id])
      .filter(Boolean) as MindMapNode[];
  }, [edges, node, nodes]);

  const submit = () => {
    if (!node) {
      return;
    }

    const nextTitle = draft.trim();
    if (nextTitle && nextTitle !== node.title) {
      onUpdateTitle(node.id, nextTitle);
    }

    const nextNote = noteDraft.trim();
    if (nextNote !== (node.note ?? "")) {
      onUpdateNote(node.id, nextNote || undefined);
    }

    const nextTags = Array.from(
      new Set(
        tagsDraft
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean)
      )
    );
    const currentTags = node.tags ?? [];
    const tagsChanged =
      nextTags.length !== currentTags.length ||
      nextTags.some((tag, index) => tag !== currentTags[index]);

    if (tagsChanged) {
      onUpdateTags(node.id, nextTags);
    }
  };

  const parseDueAtDraft = () => {
    if (!node) {
      return { ok: false as const };
    }

    const dateValue = dateDraft.trim();
    const timeValue = timeDraft.trim() || "09:00";

    if (!dateValue) {
      return { ok: true as const, dueAt: undefined };
    }

    const dateMatch =
      /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(dateValue) ??
      /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(dateValue);
    const timeMatch = /^(\d{2}):(\d{2})$/.exec(timeValue);
    if (!dateMatch || !timeMatch) {
      Alert.alert(t("inspector.invalidDateTitle"), t("inspector.invalidDateMessage"));
      return { ok: false as const };
    }

    const isoLike = dateValue.indexOf("-") === 4;
    const year = Number(isoLike ? dateMatch[1] : dateMatch[3]);
    const month = Number(isoLike ? dateMatch[2] : dateMatch[2]) - 1;
    const day = Number(isoLike ? dateMatch[3] : dateMatch[1]);
    const hour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2]);
    const nextDate = new Date(year, month, day, hour, minute);

    if (
      Number.isNaN(nextDate.getTime()) ||
      nextDate.getFullYear() !== year ||
      nextDate.getMonth() !== month ||
      nextDate.getDate() !== day ||
      hour > 23 ||
      minute > 59
    ) {
      Alert.alert(t("inspector.invalidDateTitle"), t("inspector.invalidDateMessage"));
      return { ok: false as const };
    }

    return { ok: true as const, dueAt: nextDate.toISOString() };
  };

  const applyDueAt = () => {
    if (!node) {
      return;
    }

    const parsed = parseDueAtDraft();
    if (!parsed.ok) {
      return;
    }

    onUpdateDueAt(node.id, parsed.dueAt);
    Keyboard.dismiss();
  };

  const applyChanges = () => {
    if (!node) {
      return;
    }

    const parsed = parseDueAtDraft();
    if (!parsed.ok) {
      return;
    }

    submit();
    onUpdateDueAt(node.id, parsed.dueAt);
    Keyboard.dismiss();
    onClose();
  };

  const clearDueAt = () => {
    if (!node) {
      return;
    }

    setDateDraft("");
    setTimeDraft("");
    onUpdateDueAt(node.id, undefined);
  };

  const setQuickDate = (dayOffset: number) => {
    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + dayOffset);
    setDateDraft(formatDateDraft(nextDate));
    setTimeDraft((current) => current || "09:00");
  };

  const pickAttachment = async () => {
    if (!node) {
      return;
    }

    try {
      const result = await File.pickFileAsync();
      const file = Array.isArray(result) ? result[0] : result;
      if (!file?.uri) {
        return;
      }

      onAddAttachment(node.id, {
        id: `a_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        name: file.name || t("inspector.unnamedAttachment"),
        uri: file.uri,
        mimeType: file.type || undefined,
        size: Number.isFinite(file.size) ? file.size : undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      if (message.includes("cancel")) {
        return;
      }
      Alert.alert(t("inspector.attachmentPickFailed"));
    }
  };

  const openAttachment = async (attachment: NodeAttachment) => {
    try {
      const canOpen = await Linking.canOpenURL(attachment.uri);
      if (!canOpen) {
        Alert.alert(t("inspector.attachmentOpenFailed"), attachment.uri);
        return;
      }
      await Linking.openURL(attachment.uri);
    } catch {
      Alert.alert(t("inspector.attachmentOpenFailed"), attachment.uri);
    }
  };

  const close = () => {
    onClose();
  };

  if (!node) {
    return null;
  }

  const defaultSize = node.parentId === null ? 42 : 30;
  const canDeleteNode = node.parentId !== null;
  const dueDate = node.dueAt ? new Date(node.dueAt) : null;
  const dueLabel =
    dueDate && !Number.isNaN(dueDate.getTime())
      ? new Intl.DateTimeFormat(undefined, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }).format(dueDate)
      : "—";

  return (
    <View
      style={isSide ? [s.side, isDark && s.sideDark, { width: panelWidth }] : [s.sheet, isDark && s.sheetDark]}
      onLayout={(event) => {
        if (isSide) {
          onHeight(0);
          return;
        }

        const nextHeight = event.nativeEvent.layout.height;
        onHeight(nextHeight);
      }}
    >
      <View style={s.header}>
        <View />
        <View style={s.headerActions}>
          <Pressable onPress={applyChanges} style={({ pressed }) => [s.saveButton, pressed && s.pressed]}>
            <Text style={s.saveButtonText}>{t("common.save")}</Text>
          </Pressable>
          <Pressable onPress={close} style={({ pressed }) => [s.closeButton, isDark && s.closeButtonDark, pressed && s.pressed]}>
            <Text style={[s.closeButtonText, isDark && s.closeButtonTextDark]}>{t("common.close")}</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
      >
        <Text style={[s.title, isDark && s.titleDark]}>{t("inspector.node")}</Text>

        <View style={s.row}>
          <Text style={[s.label, isDark && s.labelDark]}>{t("inspector.name")}</Text>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={submit}
            style={[s.input, isDark && s.inputDark]}
            placeholder={t("inspector.nodeTitle")}
            placeholderTextColor={isDark ? "#94a3b8" : "#9ca3af"}
            returnKeyType="done"
          />
        </View>

        <View style={s.row}>
          <Text style={[s.label, isDark && s.labelDark]}>{t("inspector.note")}</Text>
          <TextInput
            value={noteDraft}
            onChangeText={setNoteDraft}
            onSubmitEditing={() => {
              submit();
              Keyboard.dismiss();
            }}
            style={[s.input, isDark && s.inputDark, s.textarea]}
            placeholder={t("inspector.notePlaceholder")}
            placeholderTextColor={isDark ? "#94a3b8" : "#9ca3af"}
            multiline
            blurOnSubmit
            returnKeyType="done"
            textAlignVertical="top"
          />
        </View>

        <View style={s.row}>
          <Text style={[s.label, isDark && s.labelDark]}>{t("inspector.tags")}</Text>
          <TextInput
            value={tagsDraft}
            onChangeText={setTagsDraft}
            onSubmitEditing={submit}
            style={[s.input, isDark && s.inputDark]}
            placeholder={t("inspector.tagsPlaceholder")}
            placeholderTextColor={isDark ? "#94a3b8" : "#9ca3af"}
            returnKeyType="done"
          />
          <Text style={[s.helper, isDark && s.helperDark]}>{t("inspector.tagsHint")}</Text>
        </View>

        <View style={s.section}>
          <Text style={[s.sectionTitle, isDark && s.sectionTitleDark]}>{t("inspector.schedule")}</Text>
          <View style={s.infoRow}>
            <Text style={[s.label, isDark && s.labelDark]}>{t("inspector.currentDate")}</Text>
            <Text style={[s.value, isDark && s.valueDark]}>{dueLabel}</Text>
          </View>
          <View style={s.pills}>
            <Pressable onPress={() => setQuickDate(0)} style={({ pressed }) => [s.pill, isDark && s.pillDark, pressed && s.pressed]}>
              <Text style={[s.pillText, isDark && s.pillTextDark]}>{t("inspector.today")}</Text>
            </Pressable>
            <Pressable onPress={() => setQuickDate(1)} style={({ pressed }) => [s.pill, isDark && s.pillDark, pressed && s.pressed]}>
              <Text style={[s.pillText, isDark && s.pillTextDark]}>{t("inspector.tomorrow")}</Text>
            </Pressable>
          </View>
          <View style={s.inlineInputs}>
            <View style={s.inlineInputCell}>
              <Text style={[s.label, isDark && s.labelDark]}>{t("inspector.date")}</Text>
              <TextInput
                value={dateDraft}
                onChangeText={setDateDraft}
                style={[s.input, isDark && s.inputDark]}
                placeholder="27.04.2026"
                placeholderTextColor={isDark ? "#94a3b8" : "#9ca3af"}
                keyboardType="numbers-and-punctuation"
                returnKeyType="done"
              />
            </View>
            <View style={s.inlineInputCell}>
              <Text style={[s.label, isDark && s.labelDark]}>{t("inspector.time")}</Text>
              <TextInput
                value={timeDraft}
                onChangeText={setTimeDraft}
                style={[s.input, isDark && s.inputDark]}
                placeholder="09:00"
                placeholderTextColor={isDark ? "#94a3b8" : "#9ca3af"}
                keyboardType="numbers-and-punctuation"
                returnKeyType="done"
              />
            </View>
          </View>
          <View style={s.pills}>
            <Pressable onPress={applyDueAt} style={({ pressed }) => [s.pill, s.pillActive, pressed && s.pressed]}>
              <Text style={[s.pillText, s.pillTextActive]}>{t("inspector.setDate")}</Text>
            </Pressable>
            <Pressable onPress={clearDueAt} style={({ pressed }) => [s.pill, isDark && s.pillDark, pressed && s.pressed]}>
              <Text style={[s.pillText, isDark && s.pillTextDark]}>{t("inspector.clearDate")}</Text>
            </Pressable>
          </View>
        </View>

        <View style={s.section}>
          <Text style={[s.sectionTitle, isDark && s.sectionTitleDark]}>{t("inspector.attachments")}</Text>
          <View style={s.stack}>
            {(node.attachments ?? []).length === 0 ? (
              <Text style={[s.value, isDark && s.valueDark]}>—</Text>
            ) : (
              (node.attachments ?? []).map((attachment) => (
                <View key={attachment.id} style={[s.attachmentRow, isDark && s.attachmentRowDark]}>
                  <Pressable onPress={() => openAttachment(attachment)} style={({ pressed }) => [s.attachmentLink, pressed && s.pressed]}>
                    <Text numberOfLines={1} style={[s.attachmentTitle, isDark && s.attachmentTitleDark]}>
                      {attachment.name}
                    </Text>
                    <Text numberOfLines={1} style={[s.attachmentUri, isDark && s.attachmentUriDark]}>
                      {attachment.uri}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => onRemoveAttachment(node.id, attachment.id)}
                    style={({ pressed }) => [s.attachmentRemove, pressed && s.pressed]}
                  >
                    <Text style={s.attachmentRemoveText}>{t("common.delete")}</Text>
                  </Pressable>
                </View>
              ))
            )}
          </View>
          <Pressable onPress={pickAttachment} style={({ pressed }) => [s.addAttachmentButton, pressed && s.pressed]}>
            <Text style={s.addAttachmentButtonText}>{t("inspector.chooseFile")}</Text>
          </Pressable>
        </View>

        <View style={s.row}>
          <Text style={[s.label, isDark && s.labelDark]}>{t("inspector.color")}</Text>
          <View style={s.paletteWrap}>
            {PALETTE.map((color) => {
              const active = (node.color ?? "") === color;
              return (
                <Pressable
                  key={color}
                  onPress={() => onUpdateColor(node.id, color)}
                  style={({ pressed }) => [
                    s.swatch,
                    { backgroundColor: color },
                    active && s.swatchActive,
                    pressed && s.pressed,
                  ]}
                />
              );
            })}
            <Pressable
              onPress={() => onUpdateColor(node.id, undefined)}
              style={({ pressed }) => [s.defaultButton, isDark && s.defaultButtonDark, pressed && s.pressed]}
            >
              <Text style={[s.defaultButtonText, isDark && s.defaultButtonTextDark]}>{t("common.default")}</Text>
            </Pressable>
          </View>
        </View>

        <View style={s.section}>
          <Text style={[s.sectionTitle, isDark && s.sectionTitleDark]}>{t("inspector.content")}</Text>

          <View style={s.infoRow}>
            <Text style={[s.label, isDark && s.labelDark]}>{t("inspector.subtree")}</Text>
            <View style={s.pills}>
              <Pressable
                onPress={() => onUpdateCollapsed(node.id, false)}
                style={({ pressed }) => [
                  s.pill,
                  isDark && s.pillDark,
                  !node.collapsed && s.pillActive,
                  pressed && s.pressed,
                ]}
              >
                <Text style={[s.pillText, isDark && s.pillTextDark, !node.collapsed && s.pillTextActive]}>{t("inspector.expanded")}</Text>
              </Pressable>
              <Pressable
                onPress={() => onUpdateCollapsed(node.id, true)}
                style={({ pressed }) => [
                  s.pill,
                  isDark && s.pillDark,
                  !!node.collapsed && s.pillActive,
                  pressed && s.pressed,
                ]}
              >
                <Text style={[s.pillText, isDark && s.pillTextDark, !!node.collapsed && s.pillTextActive]}>{t("inspector.collapsed")}</Text>
              </Pressable>
            </View>
          </View>

          <View style={s.infoRow}>
            <Text style={[s.label, isDark && s.labelDark]}>{t("inspector.storedTags")}</Text>
            <View style={s.stackInline}>
              {(node.tags ?? []).length === 0 ? (
                <Text style={[s.value, isDark && s.valueDark]}>—</Text>
              ) : (
                (node.tags ?? []).map((tag) => (
                  <View key={tag} style={s.tagChip}>
                    <Text style={s.tagChipText}>{tag}</Text>
                  </View>
                ))
              )}
            </View>
          </View>
        </View>

        <View style={s.section}>
          <Text style={[s.sectionTitle, isDark && s.sectionTitleDark]}>{t("inspector.hierarchy")}</Text>

          <View style={s.infoRow}>
            <Text style={[s.label, isDark && s.labelDark]}>{t("inspector.parent")}</Text>
            {parent ? (
              <Pressable onPress={() => onSelectNode(parent.id)} style={({ pressed }) => [s.linkButton, pressed && s.pressed]}>
                <Text style={s.linkButtonText}>{parent.title}</Text>
              </Pressable>
            ) : (
              <Text style={[s.value, isDark && s.valueDark]}>—</Text>
            )}
          </View>

          <View style={s.infoRow}>
            <Text style={[s.label, isDark && s.labelDark]}>{t("inspector.children")}</Text>
            <View style={s.stack}>
              {children.length === 0 ? (
                <Text style={[s.value, isDark && s.valueDark]}>—</Text>
              ) : (
                children.map((child) => (
                  <Pressable
                    key={child.id}
                    onPress={() => onSelectNode(child.id)}
                    style={({ pressed }) => [s.linkButton, pressed && s.pressed]}
                  >
                    <Text style={s.linkButtonText}>{child.title}</Text>
                  </Pressable>
                ))
              )}
            </View>
          </View>
        </View>

        <View style={s.section}>
          <Text style={[s.sectionTitle, isDark && s.sectionTitleDark]}>{t("inspector.connections")}</Text>
          <View style={s.stack}>
            {connections.length === 0 ? (
              <Text style={[s.value, isDark && s.valueDark]}>—</Text>
            ) : (
              connections.map((connectedNode) => (
                <View key={connectedNode.id} style={s.connectionRow}>
                  <Pressable
                    onPress={() => onSelectNode(connectedNode.id)}
                    style={({ pressed }) => [s.linkButton, s.connectionLink, pressed && s.pressed]}
                  >
                    <Text style={s.linkButtonText}>{connectedNode.title}</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => onDeleteConnection?.(node.id, connectedNode.id)}
                    style={({ pressed }) => [s.deleteConnectionButton, isDark && s.deleteConnectionButtonDark, pressed && s.pressed]}
                  >
                    <Text style={s.deleteConnectionButtonText}>{t("common.delete")}</Text>
                  </Pressable>
                </View>
              ))
            )}
          </View>
        </View>

        <View style={s.section}>
          <Text style={[s.sectionTitle, isDark && s.sectionTitleDark]}>{t("inspector.dangerZone")}</Text>

          {canDeleteNode ? (
            <Pressable
              onPress={() =>
                Alert.alert(
                  t("inspector.deleteNodeQuestion"),
                  t("inspector.deleteNodeExplanation"),
                  [
                    { text: t("common.cancel"), style: "cancel" },
                    {
                      text: t("common.delete"),
                      style: "destructive",
                      onPress: () => onDeleteNode?.(node.id),
                    },
                  ]
                )
              }
              style={({ pressed }) => [s.dangerAction, pressed && s.pressed]}
            >
              <Text style={s.dangerActionText}>{t("inspector.deleteNode")}</Text>
            </Pressable>
          ) : (
            <View style={[s.disabledInfo, isDark && s.disabledInfoDark]}>
              <Text style={[s.disabledInfoText, isDark && s.disabledInfoTextDark]}>{t("inspector.rootCannotDelete")}</Text>
            </View>
          )}
        </View>

        <View style={s.section}>
          <Text style={[s.sectionTitle, isDark && s.sectionTitleDark]}>{t("inspector.appearance")}</Text>

          <View style={s.infoRow}>
            <Text style={[s.label, isDark && s.labelDark]}>{t("inspector.size")}</Text>
            <View style={s.stepper}>
              <Pressable
                onPress={() =>
                  onUpdateSize?.(node.id, Math.max(node.parentId === null ? 36 : 24, (node.size ?? defaultSize) - 4))
                }
                style={({ pressed }) => [s.stepButton, isDark && s.stepButtonDark, pressed && s.pressed]}
              >
                <Text style={[s.stepButtonText, isDark && s.stepButtonTextDark]}>−</Text>
              </Pressable>
              <Text style={[s.stepValue, isDark && s.stepValueDark]}>{node.size ?? defaultSize}</Text>
              <Pressable
                onPress={() =>
                  onUpdateSize?.(node.id, Math.min(88, (node.size ?? defaultSize) + 4))
                }
                style={({ pressed }) => [s.stepButton, isDark && s.stepButtonDark, pressed && s.pressed]}
              >
                <Text style={[s.stepButtonText, isDark && s.stepButtonTextDark]}>＋</Text>
              </Pressable>
            </View>
          </View>

          <View style={s.infoRow}>
            <Text style={[s.label, isDark && s.labelDark]}>{t("inspector.shape")}</Text>
            <View style={s.pills}>
              {([
                { key: "circle", label: t("inspector.circle") },
                { key: "rounded", label: t("inspector.rounded") },
                { key: "capsule", label: t("inspector.capsule") },
              ] as const).map((item) => {
                const active = (node.shape ?? "circle") === item.key;
                return (
                  <Pressable
                    key={item.key}
                    onPress={() => onUpdateShape?.(node.id, item.key)}
                    style={({ pressed }) => [s.pill, isDark && s.pillDark, active && s.pillActive, pressed && s.pressed]}
                  >
                    <Text style={[s.pillText, isDark && s.pillTextDark, active && s.pillTextActive]}>{item.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={s.infoRow}>
            <Text style={[s.label, isDark && s.labelDark]}>{t("inspector.line")}</Text>
            <View style={s.pills}>
              {([
                { key: "solid", label: t("map.solid") },
                { key: "dashed", label: t("map.dashed") },
              ] as const).map((item) => {
                const active = (node.edgeToParent?.style ?? "solid") === item.key;
                return (
                  <Pressable
                    key={item.key}
                    onPress={() => onUpdateEdge?.(node.id, { style: item.key })}
                    style={({ pressed }) => [s.pill, isDark && s.pillDark, active && s.pillActive, pressed && s.pressed]}
                  >
                    <Text style={[s.pillText, isDark && s.pillTextDark, active && s.pillTextActive]}>{item.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={s.infoRow}>
            <Text style={[s.label, isDark && s.labelDark]}>{t("map.width")}</Text>
            <View style={s.stepper}>
              <Pressable
                onPress={() =>
                  onUpdateEdge?.(node.id, {
                    width: Math.max(1, (node.edgeToParent?.width ?? 2) - 1),
                  })
                }
                style={({ pressed }) => [s.stepButton, isDark && s.stepButtonDark, pressed && s.pressed]}
              >
                <Text style={[s.stepButtonText, isDark && s.stepButtonTextDark]}>−</Text>
              </Pressable>
              <Text style={[s.stepValue, isDark && s.stepValueDark]}>{node.edgeToParent?.width ?? 2}</Text>
              <Pressable
                onPress={() =>
                  onUpdateEdge?.(node.id, {
                    width: Math.min(10, (node.edgeToParent?.width ?? 2) + 1),
                  })
                }
                style={({ pressed }) => [s.stepButton, isDark && s.stepButtonDark, pressed && s.pressed]}
              >
                <Text style={[s.stepButtonText, isDark && s.stepButtonTextDark]}>＋</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    shadowColor: "#000000",
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 10,
    maxHeight: "50%",
  },
  sheetDark: {
    backgroundColor: "#0f172a",
    borderColor: "#334155",
  },
  side: {
    borderRadius: 24,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    marginLeft: 12,
    marginRight: 12,
    marginBottom: 12,
    marginTop: 12,
    shadowColor: "#000000",
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 8,
  },
  sideDark: {
    backgroundColor: "#0f172a",
    borderColor: "#334155",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  closeButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: "#f3f4f6",
  },
  closeButtonDark: {
    backgroundColor: "#1e293b",
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  saveButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: "#0ea5e9",
  },
  saveButtonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "800",
  },
  closeButtonText: {
    color: "#111827",
    fontSize: 13,
    fontWeight: "700",
  },
  closeButtonTextDark: {
    color: "#f8fafc",
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 18,
  },
  title: {
    fontSize: 20,
    fontWeight: "800",
    color: "#111827",
  },
  titleDark: {
    color: "#f8fafc",
  },
  row: {
    gap: 10,
  },
  infoRow: {
    gap: 10,
  },
  label: {
    fontSize: 13,
    fontWeight: "700",
    color: "#475569",
  },
  labelDark: {
    color: "#cbd5e1",
  },
  input: {
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#d1d5db",
    paddingHorizontal: 12,
    backgroundColor: "#ffffff",
    color: "#111827",
  },
  inputDark: {
    borderColor: "#334155",
    backgroundColor: "#111827",
    color: "#f8fafc",
  },
  textarea: {
    height: 100,
    paddingTop: 12,
    paddingBottom: 12,
  },
  helper: {
    fontSize: 12,
    color: "#64748b",
  },
  helperDark: {
    color: "#94a3b8",
  },
  inlineInputs: {
    flexDirection: "row",
    gap: 10,
  },
  inlineInputCell: {
    flex: 1,
    gap: 8,
  },
  attachmentRow: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10,
    borderRadius: 12,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  attachmentRowDark: {
    backgroundColor: "#111827",
    borderColor: "#334155",
  },
  attachmentLink: {
    flex: 1,
    gap: 3,
  },
  attachmentTitle: {
    color: "#0f172a",
    fontSize: 13,
    fontWeight: "800",
  },
  attachmentTitleDark: {
    color: "#f8fafc",
  },
  attachmentUri: {
    color: "#64748b",
    fontSize: 11,
    fontWeight: "600",
  },
  attachmentUriDark: {
    color: "#94a3b8",
  },
  attachmentRemove: {
    minHeight: 34,
    justifyContent: "center",
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: "#fee2e2",
  },
  attachmentRemoveText: {
    color: "#b91c1c",
    fontSize: 11,
    fontWeight: "900",
  },
  addAttachmentButton: {
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: "#0ea5e9",
  },
  addAttachmentButtonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "900",
  },
  paletteWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    alignItems: "center",
  },
  swatch: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: "transparent",
  },
  swatchActive: {
    borderColor: "#0f172a",
  },
  defaultButton: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "#f3f4f6",
  },
  defaultButtonDark: {
    backgroundColor: "#1e293b",
  },
  defaultButtonText: {
    color: "#111827",
    fontSize: 12,
    fontWeight: "700",
  },
  defaultButtonTextDark: {
    color: "#f8fafc",
  },
  section: {
    gap: 12,
    paddingTop: 4,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: "#111827",
  },
  sectionTitleDark: {
    color: "#f8fafc",
  },
  stack: {
    gap: 8,
  },
  stackInline: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    alignItems: "center",
  },
  connectionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  linkButton: {
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: "#eff6ff",
  },
  connectionLink: {
    flex: 1,
  },
  linkButtonText: {
    color: "#0369a1",
    fontSize: 13,
    fontWeight: "700",
  },
  deleteConnectionButton: {
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "#fee2e2",
  },
  deleteConnectionButtonDark: {
    backgroundColor: "rgba(127, 29, 29, 0.9)",
  },
  deleteConnectionButtonText: {
    color: "#b91c1c",
    fontSize: 12,
    fontWeight: "800",
  },
  dangerAction: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: "#fee2e2",
    borderWidth: 1,
    borderColor: "#fecaca",
  },
  dangerActionText: {
    color: "#b91c1c",
    fontSize: 13,
    fontWeight: "800",
  },
  disabledInfo: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  disabledInfoDark: {
    backgroundColor: "#111827",
    borderColor: "#334155",
  },
  disabledInfoText: {
    color: "#64748b",
    fontSize: 13,
    fontWeight: "600",
  },
  disabledInfoTextDark: {
    color: "#94a3b8",
  },
  value: {
    color: "#64748b",
    fontSize: 14,
  },
  valueDark: {
    color: "#cbd5e1",
  },
  tagChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#e0f2fe",
  },
  tagChipText: {
    color: "#075985",
    fontSize: 12,
    fontWeight: "700",
  },
  pills: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#f3f4f6",
  },
  pillDark: {
    backgroundColor: "#1e293b",
  },
  pillActive: {
    backgroundColor: "#0ea5e9",
  },
  pillText: {
    color: "#334155",
    fontSize: 12,
    fontWeight: "700",
  },
  pillTextDark: {
    color: "#cbd5e1",
  },
  pillTextActive: {
    color: "#ffffff",
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  stepButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f3f4f6",
  },
  stepButtonDark: {
    backgroundColor: "#1e293b",
  },
  stepButtonText: {
    fontSize: 20,
    lineHeight: 20,
    color: "#111827",
    fontWeight: "700",
  },
  stepButtonTextDark: {
    color: "#f8fafc",
  },
  stepValue: {
    minWidth: 18,
    textAlign: "center",
    color: "#111827",
    fontSize: 15,
    fontWeight: "700",
  },
  stepValueDark: {
    color: "#f8fafc",
  },
  pressed: {
    opacity: 0.82,
  },
});
