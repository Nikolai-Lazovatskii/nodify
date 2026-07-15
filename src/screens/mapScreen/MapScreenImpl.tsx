/**
 * Súbor: src/screens/mapScreen/MapScreenImpl.tsx
 * Abstrakt: Implementuje hlavnú logiku editora mapy, uzlov, gest, hľadania a nástrojov.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  InteractionManager,
  Keyboard,
  Platform,
  Pressable,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Defs, G, Pattern, Rect, Text as SvgText } from "react-native-svg";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTranslation } from "@/src/lang/LanguagePreference";

import EdgeView from "../../components/EdgeView";
import EditableNodeView from "../../components/EditableNodeView";
import NodeInspector from "../../components/NodeInspector";
import ZoomableCanvas, { CanvasTransform, ZoomableCanvasHandle } from "../../components/ZoomableCanvas";
import { EdgeStyle, MindMap, MindMapNode, NodeAttachment, NodeShape } from "../../types/map";
import {
  DEFAULT_RELATIONSHIP_EDGE,
  DOT_GRID_LARGE,
  DOT_GRID_SMALL,
  EDGE_PALETTE,
  PROGRESSIVE_RENDER_NODE_LIMIT,
  RELATIONSHIP_LINK_COLOR,
  VIEWPORT_CULL_NODE_LIMIT,
} from "./constants";
import {
  collectVisibleNodeIds,
  hasImportedLayoutData,
  hasRelationshipEdge,
  normalizeMap,
  normalizeSearchValue,
  prepareMapLayout,
  removeRelationshipEdge,
} from "./mapModel";
import {
  estimateNodeHalfBounds,
  findNearestInsertionSlot,
  getDisplayNodeTitle,
  getNodeImageAttachment,
  INSERTION_SLOT_X_GAP,
  NODE_IMAGE_THUMB_SIZE,
} from "./routing";
import {
  getNodeRenderBounds,
  useMapCanvasMetrics,
  viewportContainsNode,
} from "./canvasGeometry";
import { useMapEdgeRouting } from "./useMapEdgeRouting";
import { ui } from "./uiStyles";
import { styles } from "../MapScreen.styles";

type Props = {
  initialMap?: MindMap;
  onMapChange?: (map: MindMap) => void;
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getNextDefaultNodeTitle(nodes: Record<string, MindMapNode>, localizedBaseTitle: string) {
  const knownBaseTitles = Array.from(new Set([localizedBaseTitle, "New node", "Nový uzol"]));
  let highestIndex = 0;

  for (const node of Object.values(nodes)) {
    const title = node.title.trim();

    for (const baseTitle of knownBaseTitles) {
      if (title === baseTitle) {
        highestIndex = Math.max(highestIndex, 1);
        continue;
      }

      const match = title.match(new RegExp(`^${escapeRegExp(baseTitle)}\\s+(\\d+)$`));
      if (match) {
        highestIndex = Math.max(highestIndex, Number(match[1]));
      }
    }
  }

  return `${localizedBaseTitle} ${highestIndex + 1}`;
}

export default function MapScreen({ initialMap, onMapChange }: Props) {
  const { t } = useTranslation();
  const colorScheme = useColorScheme() ?? "light";
  const isDark = colorScheme === "dark";
  const insets = useSafeAreaInsets();
  const { width: screenW, height: screenH } = useWindowDimensions();
  const isLandscape = screenW > screenH;
  const [canvasKey, setCanvasKey] = useState(0);
  const lastOrientation = useRef(isLandscape);
  const didMount = useRef(false);
  const lref = useRef<string | null>(null);
  const [sid, setSid] = useState<string | null>(null);
  const [seid, setSeid] = useState<string | null>(null);
  const [lnk, setLnk] = useState<string | null>(null);
  const [cpId, setCpId] = useState<string | null>(null);
  const [rpId, setRpId] = useState<string | null>(null);
  const [ih, setIh] = useState(0);
  const [z, setZ] = useState(1);
  const [zh, setZh] = useState(false);
  const [q, setQ] = useState("");
  const [mt, setMt] = useState<string | null>(null);
  const [mb, setMb] = useState(false);
  const [bigM, setBigM] = useState(false);
  const [bigV, setBigV] = useState(false);
  const [sr, setSr] = useState(false);
  const [ct, setCt] = useState<CanvasTransform>({
    tx: 0,
    ty: 0,
    scale: 1,
    width: screenW,
    height: screenH,
  });
  const [map, setMap] = useState<MindMap>(() => prepareMapLayout(normalizeMap(initialMap, t)));
  const didNotifyMapChange = useRef(false);
  const mapRef = useRef(map);
  const canvasRef = useRef<ZoomableCanvasHandle | null>(null);
  const didAutoFitMapIdRef = useRef<string | null>(null);
  const zhRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mtRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lm = lnk !== null;
  const cpm = cpId !== null;
  const totalNodeCount = Object.keys(map.nodes).length;
  const nodes = useMemo(() => Object.values(map.nodes), [map.nodes]);
  const {
    WORLD_W,
    WORLD_H,
    SURFACE_W,
    SURFACE_H,
    VIEWBOX,
    mapBounds,
    worldViewport,
    worldToSurfaceX,
    worldToSurfaceY,
    surfaceToWorldX,
    surfaceToWorldY,
  } = useMapCanvasMetrics({
    nodes,
    rootId: map.rootId,
    totalNodeCount,
    screenW,
    screenH,
    isLandscape,
    transform: ct,
  });
  const backgroundBase = isDark ? "#020617" : "#f8fafc";
  const showDotGrid = true;
  const dotMinor = isDark ? "rgba(148,163,184,0.18)" : "rgba(148,163,184,0.28)";
  const dotMajor = isDark ? "rgba(148,163,184,0.28)" : "rgba(100,116,139,0.34)";

  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      setCanvasKey((value) => value + 1);
      lastOrientation.current = isLandscape;
      return;
    }

    if (lastOrientation.current !== isLandscape) {
      lastOrientation.current = isLandscape;
      setCanvasKey((value) => value + 1);
    }
  }, [isLandscape]);

  useEffect(() => {
    lref.current = lnk;
  }, [lnk]);

  useEffect(() => {
    mapRef.current = map;
  }, [map]);

  useEffect(() => {
    if (!didNotifyMapChange.current) {
      didNotifyMapChange.current = true;
      return;
    }

    onMapChange?.(map);
  }, [map, onMapChange]);

  const applyMap = (updater: (prev: MindMap) => MindMap) => {
    setMap((prev) => {
      const next = updater(prev);
      return prepareMapLayout(next);
    });
  };

  useEffect(() => {
    return () => {
      if (zhRef.current) {
        clearTimeout(zhRef.current);
      }
      if (mtRef.current) {
        clearTimeout(mtRef.current);
      }
    };
  }, []);

  const viditelneIdcka = useMemo(() => collectVisibleNodeIds(map), [map]);
  const viditelneUzly = useMemo(
    () => nodes.filter((node) => viditelneIdcka.has(node.id)),
    [nodes, viditelneIdcka]
  );
  const velkaMapa = totalNodeCount >= PROGRESSIVE_RENDER_NODE_LIMIT;
  const orezVyrezu = totalNodeCount > VIEWPORT_CULL_NODE_LIMIT;
  const importRozlozenie = useMemo(() => hasImportedLayoutData(map), [map]);
  const mudreCesty = velkaMapa || importRozlozenie;
  const smartRelationshipRoutes = !mudreCesty;
  const svgNodeMode = velkaMapa || importRozlozenie;
  const kreslitObsah = !velkaMapa || bigM;
  const nacitavaVelka = velkaMapa && !bigV;
  const kresleneUzly = useMemo(() => {
    if (!velkaMapa) {
      return viditelneUzly;
    }
    if (!bigM) {
      return [];
    }
    if (!orezVyrezu) {
      return viditelneUzly;
    }

    const nextNodes = viditelneUzly.filter((node) =>
      viewportContainsNode(worldViewport, node, node.id === map.rootId)
    );
    const included = new Set(nextNodes.map((node) => node.id));

    const includeNode = (nodeId: string | null) => {
      if (!nodeId || included.has(nodeId)) {
        return;
      }

      const node = map.nodes[nodeId];
      if (node && viditelneIdcka.has(nodeId)) {
        nextNodes.push(node);
        included.add(nodeId);
      }
    };

    includeNode(map.rootId);
    includeNode(sid);
    if (cpId) {
      includeNode(cpId);
    }
    if (lnk) {
      includeNode(lnk);
    }
    if (rpId) {
      includeNode(rpId);
    }

    return nextNodes;
  }, [
    cpId,
    velkaMapa,
    bigM,
    lnk,
    map.nodes,
    map.rootId,
    rpId,
    sid,
    orezVyrezu,
    viditelneIdcka,
    viditelneUzly,
    worldViewport,
  ]);
  const kresleneIdcka = useMemo(
    () => new Set(kresleneUzly.map((node) => node.id)),
    [kresleneUzly]
  );
  useEffect(() => {
    setSr(true);
  }, [velkaMapa, map.id, worldViewport.left, worldViewport.right, worldViewport.top, worldViewport.bottom]);
  useEffect(() => {
    if (!velkaMapa) {
      setBigM(true);
      setBigV(true);
      return;
    }

    setBigM(false);
    setBigV(false);
    const timer = setTimeout(() => {
      setBigM(true);
    }, 120);

    return () => clearTimeout(timer);
  }, [velkaMapa, map.id]);
  useEffect(() => {
    if (!velkaMapa || !bigM) {
      return;
    }

    setBigV(false);
    let revealTimer: ReturnType<typeof setTimeout> | null = null;
    const interaction = InteractionManager.runAfterInteractions(() => {
      revealTimer = setTimeout(() => {
        setBigV(true);
      }, 900);
    });

    return () => {
      interaction.cancel?.();
      if (revealTimer) {
        clearTimeout(revealTimer);
      }
    };
  }, [bigM, velkaMapa, map.id]);
  const {
    routedTreeEdges,
    treeEdges: stromHrany,
    relationshipEdges: vztahHrany,
    simpleRelationshipRoutes: jednoducheTrasyVztahov,
    smartRelationshipRoutesById: rre,
    relationshipDisplayColors: farbyVztahov,
  } = useMapEdgeRouting({
    map,
    renderedNodes: kresleneUzly,
    renderedNodeIds: kresleneIdcka,
    isLargeMap: velkaMapa,
    preferSelectiveRouting: mudreCesty,
    smartRelationshipRoutes,
    routesReady: sr,
  });
  const postupMapy = velkaMapa
    ? bigV ? 100 : bigM ? 90 : 55
    : 100;
  const ukazPostupMapy = nacitavaVelka;
  const hladaneTrim = q.trim();
  const vysledkyHladania = useMemo(() => {
    const query = normalizeSearchValue(q);
    if (!query) {
      return [];
    }

    const results: { node: MindMapNode; subtitle: string }[] = [];

    for (const node of nodes) {
      const attachmentNames = (node.attachments ?? []).map((attachment) => attachment.name);
      const fields = [node.title, node.note, node.dueAt, ...(node.tags ?? []), ...attachmentNames];
      const haystack = normalizeSearchValue(fields.join(" "));
      if (!haystack.includes(query)) {
        continue;
      }

      const tagMatch = (node.tags ?? []).some((tag) => normalizeSearchValue(tag).includes(query));
      const noteMatch = normalizeSearchValue(node.note).includes(query);
      const hidden = !viditelneIdcka.has(node.id);

      results.push({
        node,
        subtitle: tagMatch
          ? `${t("map.tagMatch")}${hidden ? ` ${t("map.hiddenCollapsed")}` : ""}`
          : noteMatch
            ? `${t("map.noteMatch")}${hidden ? ` ${t("map.hiddenCollapsed")}` : ""}`
            : node.collapsed
              ? `${t("map.titleMatch")} ${t("map.collapsed")}`
              : hidden
                ? `${t("map.titleMatch")} ${t("map.hiddenCollapsed")}`
                : t("map.titleMatch"),
      });

      if (results.length >= 8) {
        break;
      }
    }

    return results;
  }, [nodes, q, t, viditelneIdcka]);
  const selectedNode = sid ? map.nodes[sid] ?? null : null;
  const selectedEdge = seid ? map.edges.find((edge) => edge.id === seid) ?? null : null;
  const selectedEdgeFromNode = selectedEdge ? map.nodes[selectedEdge.fromId] ?? null : null;
  const selectedEdgeToNode = selectedEdge ? map.nodes[selectedEdge.toId] ?? null : null;
  const shouldShowInspector = !!selectedNode && !lm && !cpm && !selectedEdge && !rpId;
  const bottomInset = !isLandscape && shouldShowInspector ? Math.max(ih, 220) : 0;
  const containerPaddingTop = isLandscape ? 0 : Math.max(insets.top, 8);
  const containerPaddingBottom = isLandscape ? Math.max(insets.bottom, 8) : Math.max(insets.bottom, 12);
  const containerPaddingLeft = isLandscape ? Math.max(insets.left, 12) : 16;
  const containerPaddingRight = isLandscape ? Math.max(insets.right, 12) : 16;
  const canvasTopGap = isLandscape ? 0 : 8;
  const inspectorSideWidth = Math.min(360, Math.max(292, screenW * 0.34));

  useEffect(() => {
    if (velkaMapa || !selectedNode || lm || cpm || selectedEdge || rpId) {
      return;
    }

    const focusScale = z || 1;
    canvasRef.current?.centerOn(
      worldToSurfaceX(selectedNode.x),
      worldToSurfaceY(selectedNode.y),
      focusScale
    );
  }, [
    z,
    cpm,
    velkaMapa,
    lm,
    rpId,
    selectedEdge,
    selectedNode,
    worldToSurfaceX,
    worldToSurfaceY,
  ]);

  useEffect(() => {
    if (!svgNodeMode || (velkaMapa && !bigV) || didAutoFitMapIdRef.current === map.id) {
      return;
    }

    didAutoFitMapIdRef.current = map.id;
    const availableW = Math.max(1, ct.width - 48);
    const availableH = Math.max(1, ct.height - 48);
    const contentW = Math.max(1, mapBounds.width * (SURFACE_W / Math.max(1, WORLD_W)));
    const contentH = Math.max(1, mapBounds.height * (SURFACE_H / Math.max(1, WORLD_H)));
    const fitScale = Math.max(
      0.25,
      Math.min(1, availableW / contentW, availableH / contentH)
    );

    const rootNode = map.nodes[map.rootId];
    canvasRef.current?.centerOn(
      worldToSurfaceX(rootNode?.x ?? mapBounds.centerX),
      worldToSurfaceY(rootNode?.y ?? mapBounds.centerY),
      fitScale
    );
  }, [
    SURFACE_H,
    SURFACE_W,
    WORLD_H,
    WORLD_W,
    ct.height,
    ct.width,
    velkaMapa,
    bigV,
    map.id,
    map.nodes,
    map.rootId,
    mapBounds.centerX,
    mapBounds.centerY,
    mapBounds.height,
    mapBounds.width,
    svgNodeMode,
    worldToSurfaceX,
    worldToSurfaceY,
  ]);

  const updateTitle = (nodeId: string, newTitle: string) => {
    applyMap((prev) => ({
      ...prev,
      nodes: {
        ...prev.nodes,
        [nodeId]: { ...prev.nodes[nodeId], title: newTitle },
      },
    }));
  };

  const updateNote = (nodeId: string, note: string | undefined) => {
    applyMap((prev) => ({
      ...prev,
      nodes: {
        ...prev.nodes,
        [nodeId]: { ...prev.nodes[nodeId], note },
      },
    }));
  };

  const updateTags = (nodeId: string, tags: string[]) => {
    applyMap((prev) => ({
      ...prev,
      nodes: {
        ...prev.nodes,
        [nodeId]: { ...prev.nodes[nodeId], tags: tags.length > 0 ? tags : undefined },
      },
    }));
  };

  const updateDueAt = (nodeId: string, dueAt: string | undefined) => {
    applyMap((prev) => ({
      ...prev,
      nodes: {
        ...prev.nodes,
        [nodeId]: { ...prev.nodes[nodeId], dueAt },
      },
    }));
  };

  const addAttachment = (nodeId: string, attachment: NodeAttachment) => {
    applyMap((prev) => {
      const node = prev.nodes[nodeId];
      if (!node) {
        return prev;
      }

      return {
        ...prev,
        nodes: {
          ...prev.nodes,
          [nodeId]: {
            ...node,
            attachments: [...(node.attachments ?? []), attachment],
          },
        },
      };
    });
  };

  const removeAttachment = (nodeId: string, attachmentId: string) => {
    applyMap((prev) => {
      const node = prev.nodes[nodeId];
      if (!node) {
        return prev;
      }

      const attachments = (node.attachments ?? []).filter((attachment) => attachment.id !== attachmentId);

      return {
        ...prev,
        nodes: {
          ...prev.nodes,
          [nodeId]: {
            ...node,
            attachments: attachments.length ? attachments : undefined,
          },
        },
      };
    });
  };

  const updateCollapsed = (nodeId: string, collapsed: boolean) => {
    applyMap((prev) => ({
      ...prev,
      nodes: {
        ...prev.nodes,
        [nodeId]: { ...prev.nodes[nodeId], collapsed },
      },
    }));
  };

  const updateColor = (nodeId: string, newColor: string | undefined) => {
    applyMap((prev) => ({
      ...prev,
      nodes: {
        ...prev.nodes,
        [nodeId]: { ...prev.nodes[nodeId], color: newColor },
      },
    }));
  };

  const updateSize = (nodeId: string, size: number) => {
    applyMap((prev) => ({
      ...prev,
      nodes: {
        ...prev.nodes,
        [nodeId]: { ...prev.nodes[nodeId], size },
      },
    }));
  };

  const updateShape = (nodeId: string, shape: NodeShape | undefined) => {
    applyMap((prev) => ({
      ...prev,
      nodes: {
        ...prev.nodes,
        [nodeId]: { ...prev.nodes[nodeId], shape },
      },
    }));
  };

  const updateEdge = (nodeId: string, patch: { style?: EdgeStyle; width?: number; color?: string }) => {
    applyMap((prev) => ({
      ...prev,
      nodes: {
        ...prev.nodes,
        [nodeId]: {
          ...prev.nodes[nodeId],
          edgeToParent: {
            ...(prev.nodes[nodeId].edgeToParent ?? { style: "solid", width: 2, color: "#9ca3af" }),
            ...patch,
          },
        },
      },
    }));
  };

  const showMoveToast = useCallback((message: string) => {
    setMt(message);
    if (mtRef.current) {
      clearTimeout(mtRef.current);
    }
    mtRef.current = setTimeout(() => {
      setMt(null);
      mtRef.current = null;
    }, 2200);
  }, []);

  const attemptRepositionNode = useCallback((nodeId: string, x: number, y: number) => {
    const runMove = () => {
      try {
        const mapSnapshot = mapRef.current;
        const currentNode = mapSnapshot.nodes[nodeId];
        if (!currentNode || nodeId === mapSnapshot.rootId) {
          setRpId(null);
          return;
        }

        const slot = findNearestInsertionSlot(mapSnapshot, nodeId, x, y);

        if (!slot) {
          showMoveToast(t("map.cannotMoveNodeThere"));
          return;
        }

        applyMap((prev) => ({
          ...prev,
          nodes: (() => {
            const node = prev.nodes[nodeId];
            const target = prev.nodes[slot.parentId];
            if (!node || !target) {
              return prev.nodes;
            }

            const nextNodes = { ...prev.nodes };
            if (node.parentId && nextNodes[node.parentId]) {
              nextNodes[node.parentId] = {
                ...nextNodes[node.parentId],
                children: nextNodes[node.parentId].children.filter((childId) => childId !== nodeId),
              };
            }

            const targetAfterRemoval = nextNodes[target.id] ?? target;
            const targetChildren = [...targetAfterRemoval.children.filter((childId) => childId !== nodeId)];
            let nextTargetChildren = targetChildren;

            if (target.id === prev.rootId) {
              const leftChildren = targetChildren.filter((childId) => (nextNodes[childId]?.x ?? 0) < target.x);
              const rightChildren = targetChildren.filter((childId) => (nextNodes[childId]?.x ?? 0) >= target.x);
              const sideChildren = slot.side < 0 ? leftChildren : rightChildren;
              const sideInsertIndex = Math.max(0, Math.min(sideChildren.length, slot.index));
              sideChildren.splice(sideInsertIndex, 0, nodeId);
              nextTargetChildren = slot.side < 0
                ? [...sideChildren, ...rightChildren]
                : [...leftChildren, ...sideChildren];
            } else {
              const insertIndex = Math.max(0, Math.min(targetChildren.length, slot.index));
              targetChildren.splice(insertIndex, 0, nodeId);
              nextTargetChildren = targetChildren;
            }

            nextNodes[target.id] = {
              ...targetAfterRemoval,
              collapsed: false,
              children: nextTargetChildren,
            };
            nextNodes[nodeId] = {
              ...node,
              parentId: target.id,
              x: target.x + slot.side * INSERTION_SLOT_X_GAP,
              y,
              edgeToParent: node.edgeToParent ?? { style: "solid", width: 2, color: "#9ca3af" },
            };

            return nextNodes;
          })(),
        }));
        setRpId(null);
        setSid(nodeId);
      } finally {
        setMb(false);
      }
    };

    if (velkaMapa) {
      setMb(true);
      setTimeout(runMove, 80);
      return;
    }

    runMove();
  }, [velkaMapa, showMoveToast, t]);

  const addChildToSelected = () => {
    if (!sid) {
      return;
    }

    const newId = `n_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    applyMap((prev) => {
      const parent = prev.nodes[sid];
      if (!parent) {
        return prev;
      }

      const root = prev.nodes[prev.rootId];
      const parentSide =
        parent.id === prev.rootId
          ? parent.children.filter((childId) => (prev.nodes[childId]?.x ?? 0) >= parent.x).length <=
              parent.children.filter((childId) => (prev.nodes[childId]?.x ?? 0) < parent.x).length
            ? 1
            : -1
          : parent.x < (root?.x ?? 0)
            ? -1
            : 1;

      const child: MindMapNode = {
        id: newId,
        parentId: parent.id,
        title: getNextDefaultNodeTitle(prev.nodes, t("map.newNode")),
        x: parent.x + parentSide * INSERTION_SLOT_X_GAP,
        y: parent.y,
        children: [],
        size: 30,
        shape: "circle",
        edgeToParent: { style: "solid", width: 2, color: "#9ca3af" },
      };

      return {
        ...prev,
        nodes: {
          ...prev.nodes,
          [newId]: child,
          [parent.id]: {
            ...parent,
            children: [...parent.children, newId],
          },
        },
      };
    });

    setSeid(null);
    lref.current = null;
    setLnk(null);
    setCpId(null);
    setSid(newId);
  };

  const cancelLinkMode = () => {
    lref.current = null;
    setLnk(null);
    setSeid(null);
  };

  const startLinkMode = () => {
    if (!sid) {
      return;
    }

    if (lnk === sid) {
      cancelLinkMode();
      return;
    }

    setSeid(null);
    setCpId(null);
    lref.current = sid;
    setLnk(sid);
  };

  const cancelChangeParentMode = () => {
    setCpId(null);
  };

  const startChangeParentMode = () => {
    if (!sid || sid === map.rootId) {
      return;
    }

    setSeid(null);
    lref.current = null;
    setLnk(null);
    setCpId(sid);
  };

  const handleSelectLinkTarget = useCallback((targetId: string) => {
    const fromId = lref.current;

    if (!fromId) {
      return;
    }

    if (targetId === fromId) {
      return;
    }

    applyMap((prev) => {
      if (!prev.nodes[fromId] || !prev.nodes[targetId]) {
        return prev;
      }

      if (hasRelationshipEdge(prev.edges, fromId, targetId)) {
        return prev;
      }

      return {
        ...prev,
        edges: [
          ...prev.edges,
          {
            id: `e_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            fromId,
            toId: targetId,
            ...DEFAULT_RELATIONSHIP_EDGE,
          },
        ],
      };
    });

    lref.current = null;
    setSeid(null);
    setLnk(null);
    setCpId(null);
    setSid(null);
  }, []);

  const handleSelectChangeParentTarget = useCallback((targetId: string) => {
    const nodeId = cpId;
    if (!nodeId) {
      return;
    }

    const snapshot = mapRef.current;
    const currentNode = snapshot.nodes[nodeId];
    const targetNode = snapshot.nodes[targetId];
    const invalid =
      !currentNode ||
      !targetNode ||
      nodeId === snapshot.rootId ||
      targetId === nodeId ||
      currentNode.parentId === targetId;

    let cursor: string | null = targetId;
    while (!invalid && cursor) {
      if (cursor === nodeId) {
        showMoveToast(t("map.cannotSetParent"));
        return;
      }
      cursor = snapshot.nodes[cursor]?.parentId ?? null;
    }

    if (invalid) {
      showMoveToast(t("map.cannotSetParent"));
      return;
    }

    applyMap((prev) => {
      const node = prev.nodes[nodeId];
      const target = prev.nodes[targetId];
      if (!node || !target || nodeId === prev.rootId || targetId === nodeId || node.parentId === targetId) {
        return prev;
      }

      let cursor: string | null = targetId;
      while (cursor) {
        if (cursor === nodeId) {
          return prev;
        }
        cursor = prev.nodes[cursor]?.parentId ?? null;
      }

      const nextNodes = { ...prev.nodes };
      if (node.parentId && nextNodes[node.parentId]) {
        nextNodes[node.parentId] = {
          ...nextNodes[node.parentId],
          children: nextNodes[node.parentId].children.filter((childId) => childId !== nodeId),
        };
      }

      nextNodes[targetId] = {
        ...target,
        collapsed: false,
        children: target.children.includes(nodeId) ? target.children : [...target.children, nodeId],
      };
      nextNodes[nodeId] = {
        ...node,
        parentId: targetId,
        edgeToParent: node.edgeToParent ?? { style: "solid", width: 2, color: "#9ca3af" },
      };

      return {
        ...prev,
        nodes: nextNodes,
      };
    });

    setCpId(null);
    setSeid(null);
    lref.current = null;
    setLnk(null);
    setSid(nodeId);
  }, [cpId, showMoveToast, t]);

  const handleSelectNode = useCallback((nodeId: string) => {
    Keyboard.dismiss();
    setSeid(null);
    lref.current = null;
    setLnk(null);
    setCpId(null);
    setSid(nodeId);
  }, []);

  const handleStartReposition = useCallback((nodeId: string) => {
    Keyboard.dismiss();
    setSeid(null);
    lref.current = null;
    setLnk(null);
    setCpId(null);
    setSid(null);
    setRpId(nodeId);
  }, []);

  const revealNode = (nodeId: string) => {
    applyMap((prev) => {
      if (!prev.nodes[nodeId]) {
        return prev;
      }

      const nextNodes = { ...prev.nodes };
      let cursor = prev.nodes[nodeId];

      while (cursor?.parentId) {
        const parent = nextNodes[cursor.parentId];
        if (!parent) {
          break;
        }

        if (parent.collapsed) {
          nextNodes[parent.id] = { ...parent, collapsed: false };
        }

        cursor = parent;
      }

      return { ...prev, nodes: nextNodes };
    });
  };

  const handleSelectSearchResult = (nodeId: string) => {
    const targetNode = map.nodes[nodeId];
    revealNode(nodeId);
    Keyboard.dismiss();
    setSeid(null);
    lref.current = null;
    setLnk(null);
    setCpId(null);
    setSid(nodeId);
    setQ("");

    if (targetNode) {
      canvasRef.current?.centerOn(
        worldToSurfaceX(targetNode.x),
        worldToSurfaceY(targetNode.y),
        1
      );
    }
  };

  const resetViewToRoot = () => {
    const rootNode = map.nodes[map.rootId];
    if (!rootNode) {
      canvasRef.current?.reset();
      return;
    }

    canvasRef.current?.centerOn(
      worldToSurfaceX(rootNode.x),
      worldToSurfaceY(rootNode.y),
      1
    );
  };

  const handleZoomGestureStart = () => {
    if (zhRef.current) {
      clearTimeout(zhRef.current);
      zhRef.current = null;
    }
    setZh(true);
  };

  const handleZoomGestureEnd = () => {
    if (zhRef.current) {
      clearTimeout(zhRef.current);
    }

    zhRef.current = setTimeout(() => {
      setZh(false);
      zhRef.current = null;
    }, 700);
  };

  const handleSelectRelationshipEdge = useCallback((edgeId: string) => {
    setSeid(edgeId);
    lref.current = null;
    setLnk(null);
    setCpId(null);
    setSid(null);
  }, []);

  const handleLongPressRelationshipEdge = useCallback((edgeId: string) => {
    setSid(null);
    setSeid(edgeId);
    lref.current = null;
    setLnk(null);
    setCpId(null);
  }, []);

  const handleCanvasPress = useCallback(() => {
    if (rpId) {
      return;
    }

    Keyboard.dismiss();
    if (seid) {
      setSeid(null);
      return;
    }

    if (!lm && !cpm) {
      setSid(null);
    }
  }, [cpm, lm, rpId, seid]);

  const handlePlacementTap = useCallback((locationX: number, locationY: number) => {
    if (!rpId) {
      return;
    }

    const target = canvasRef.current?.localToWorld(locationX, locationY);
    if (!target) {
      return;
    }

    attemptRepositionNode(
      rpId,
      surfaceToWorldX(target.x),
      surfaceToWorldY(target.y)
    );
  }, [attemptRepositionNode, rpId, surfaceToWorldX, surfaceToWorldY]);

  const deleteSelectedRelationshipEdge = () => {
    if (!seid) {
      return;
    }

    applyMap((prev) => ({
      ...prev,
      edges: prev.edges.filter((edge) => edge.id !== seid),
    }));

    setSeid(null);
  };

  const updateSelectedRelationshipEdge = (patch: {
    style?: EdgeStyle;
    width?: number;
    color?: string;
  }) => {
    if (!seid) {
      return;
    }

    applyMap((prev) => ({
      ...prev,
      edges: prev.edges.map((edge) =>
        edge.id === seid
          ? {
              ...edge,
              ...patch,
            }
          : edge
      ),
    }));
  };

  const deleteConnection = (nodeId: string, connectedNodeId: string) => {
    applyMap((prev) => ({
      ...prev,
      edges: removeRelationshipEdge(prev.edges, nodeId, connectedNodeId),
    }));

    if (
      selectedEdge &&
      ((selectedEdge.fromId === nodeId && selectedEdge.toId === connectedNodeId) ||
        (selectedEdge.fromId === connectedNodeId && selectedEdge.toId === nodeId))
    ) {
      setSeid(null);
    }
  };

  const deleteNode = (nodeId: string) => {
    applyMap((prev) => {
      const node = prev.nodes[nodeId];
      if (!node || nodeId === prev.rootId) {
        return prev;
      }

      const nextNodes = { ...prev.nodes };
      const parentId = node.parentId;

      for (const childId of node.children) {
        const child = nextNodes[childId];
        if (child) {
          nextNodes[childId] = {
            ...child,
            parentId,
          };
        }
      }

      if (parentId && nextNodes[parentId]) {
        nextNodes[parentId] = {
          ...nextNodes[parentId],
          children: nextNodes[parentId].children.flatMap((childId) =>
            childId === nodeId ? [...node.children] : [childId]
          ),
        };
      }

      delete nextNodes[nodeId];

      return {
        ...prev,
        nodes: nextNodes,
        edges: prev.edges.filter((edge) => edge.fromId !== nodeId && edge.toId !== nodeId),
      };
    });

    if (sid === nodeId) {
      setSid(null);
    }
    if (lref.current === nodeId) {
      lref.current = null;
      setLnk(null);
    }
    if (selectedEdge && (selectedEdge.fromId === nodeId || selectedEdge.toId === nodeId)) {
      setSeid(null);
    }
  };

  const renderSvgNode = (node: MindMapNode) => {
    const isRootNode = node.id === map.rootId;
    const selected = node.id === sid;
    const placementMode = rpId === node.id;
    const bounds = getNodeRenderBounds(node, isRootNode);
    const isCapsule = node.shape === "capsule";
    const isCircle = node.shape === "circle";
    const fillDefault = isRootNode ? "#0ea5e9" : "#ffffff";
    const fill = node.color ?? fillDefault;
    const textColor = isRootNode && !node.color ? "#ffffff" : "#0f172a";
    const stroke = placementMode ? "#f59e0b" : selected ? "#0284c7" : isDark ? "rgba(148,163,184,0.5)" : "rgba(255,255,255,0.9)";
    const hasMeta = !!node.note || !!node.dueAt || (node.attachments ?? []).length > 0 || (node.tags ?? []).length > 0;
    const imageAttachment = getNodeImageAttachment(node);
    const hasCollapsedChildren = !!node.collapsed && node.children.length > 0;
    const baseR = Math.max(isRootNode ? 42 : 30, node.size ?? (isRootNode ? 42 : 30));
    const fontSize = Math.max(12, Math.round(baseR * (isRootNode ? 0.45 : 0.38)));
    const rx = isCapsule ? bounds.height / 2 : isCircle ? Math.min(bounds.width, bounds.height) / 2 : 18;

    const handleNodePress = (event?: { stopPropagation?: () => void }) => {
      event?.stopPropagation?.();
      if (placementMode) {
        return;
      }

      if (cpm) {
        handleSelectChangeParentTarget(node.id);
        return;
      }

      if (lm) {
        handleSelectLinkTarget(node.id);
        return;
      }

      handleSelectNode(node.id);
    };

    const handleNodeLongPress = (event?: { stopPropagation?: () => void }) => {
      event?.stopPropagation?.();
      if (lm || cpm || placementMode) {
        return;
      }

      handleStartReposition(node.id);
    };

    return (
      <G key={node.id} onPress={handleNodePress} onLongPress={handleNodeLongPress}>
        <Rect
          x={bounds.x}
          y={bounds.y}
          width={bounds.width}
          height={bounds.height}
          rx={rx}
          fill={fill}
          stroke={stroke}
          strokeWidth={selected || placementMode ? 3 : 1.5}
        />
        <SvgText
          x={node.x + (imageAttachment ? (NODE_IMAGE_THUMB_SIZE + 6) / 2 : 0)}
          y={node.y + (hasMeta ? -3 : 5)}
          fill={textColor}
          fontSize={fontSize}
          fontWeight="800"
          textAnchor="middle"
        >
          {getDisplayNodeTitle(node.title)}
        </SvgText>
        {imageAttachment ? (
          <>
            <Rect
              x={node.x - (getDisplayNodeTitle(node.title).length * fontSize * 0.3) - NODE_IMAGE_THUMB_SIZE - 4}
              y={node.y + (hasMeta ? -3 : 5) - NODE_IMAGE_THUMB_SIZE + 3}
              width={NODE_IMAGE_THUMB_SIZE}
              height={NODE_IMAGE_THUMB_SIZE}
              rx={4}
              fill={isRootNode ? "rgba(224,242,254,0.22)" : "rgba(224,242,254,0.92)"}
            />
            <Circle
              cx={node.x - (getDisplayNodeTitle(node.title).length * fontSize * 0.3) - NODE_IMAGE_THUMB_SIZE / 2 - 4}
              cy={node.y + (hasMeta ? -3 : 5) - 9}
              r={2.3}
              fill={isRootNode ? "#e0f2fe" : "#0369a1"}
            />
            <Rect
              x={node.x - (getDisplayNodeTitle(node.title).length * fontSize * 0.3) - NODE_IMAGE_THUMB_SIZE}
              y={node.y + (hasMeta ? -3 : 5) - 5}
              width={NODE_IMAGE_THUMB_SIZE - 8}
              height={4}
              rx={1.5}
              fill={isRootNode ? "#e0f2fe" : "#0369a1"}
            />
          </>
        ) : null}
        {hasMeta ? (
          <G>
            <Circle cx={node.x - 12} cy={bounds.y + bounds.height - 14} r={3.5} fill={isRootNode ? "#e0f2fe" : "#0369a1"} />
            <Circle cx={node.x} cy={bounds.y + bounds.height - 14} r={3.5} fill={isRootNode ? "#e0f2fe" : "#0369a1"} />
            <Circle cx={node.x + 12} cy={bounds.y + bounds.height - 14} r={3.5} fill={isRootNode ? "#e0f2fe" : "#0369a1"} />
          </G>
        ) : null}
        {hasCollapsedChildren ? (
          <G>
            <Circle cx={bounds.x + bounds.width - 8} cy={bounds.y + 8} r={11} fill="#0f172a" />
            <SvgText
              x={bounds.x + bounds.width - 8}
              y={bounds.y + 13}
              fill="#ffffff"
              fontSize={14}
              fontWeight="900"
              textAnchor="middle"
            >
              +
            </SvgText>
          </G>
        ) : null}
      </G>
    );
  };

  const renderLargeNodeHitbox = (node: MindMapNode) => {
    const isRootNode = node.id === map.rootId;
    const bounds = getNodeRenderBounds(node, isRootNode);
    const scaleX = SURFACE_W / Math.max(1, WORLD_W);
    const scaleY = SURFACE_H / Math.max(1, WORLD_H);
    const centerX = SURFACE_W / 2 + worldToSurfaceX(node.x);
    const centerY = SURFACE_H / 2 + worldToSurfaceY(node.y);
    const minHitSize = Math.max(32, Math.min(72, 44 / Math.max(0.35, z || 1)));
    const width = Math.max(bounds.width * scaleX, minHitSize);
    const height = Math.max(bounds.height * scaleY, minHitSize);
    const selected = node.id === sid;

    const handlePress = () => {
      if (cpm) {
        handleSelectChangeParentTarget(node.id);
        return;
      }

      if (lm) {
        handleSelectLinkTarget(node.id);
        return;
      }

      handleSelectNode(node.id);
    };

    const handleLongPress = () => {
      if (lm || cpm) {
        return;
      }

      handleStartReposition(node.id);
    };

    return (
      <Pressable
        key={`hitbox-${node.id}`}
        collapsable={false}
        onPress={handlePress}
        onLongPress={handleLongPress}
        delayLongPress={260}
        hitSlop={8}
        style={({ pressed }) => [
          {
            position: "absolute",
            left: centerX - width / 2,
            top: centerY - height / 2,
            width,
            height,
            borderRadius: Math.min(width, height) / 2,
            zIndex: selected ? 30 : 20,
            backgroundColor: pressed ? "rgba(2,132,199,0.08)" : "transparent",
          },
        ]}
      />
    );
  };

  return (
    <View
      style={[
        styles.container,
        isDark && styles.containerDark,
        {
          paddingTop: containerPaddingTop,
          paddingBottom: containerPaddingBottom,
          paddingLeft: containerPaddingLeft,
          paddingRight: containerPaddingRight,
        },
      ]}
    >
      <View style={{ flex: 1, marginTop: canvasTopGap, overflow: "hidden", flexDirection: isLandscape ? "row" : "column" }}>
        <View style={{ flex: 1, marginBottom: isLandscape ? 0 : bottomInset, alignItems: "stretch", justifyContent: "center" }}>
          <ZoomableCanvas
            ref={canvasRef}
            key={`canvas:${map.id}:${canvasKey}`}
            enabled={!rpId}
            minScale={svgNodeMode ? 0.12 : 0.25}
            maxScale={1}
            onScaleChange={setZ}
            onDoubleTap={resetViewToRoot}
            tapEnabled={!!rpId}
            onTapPoint={handlePlacementTap}
            onZoomGestureStart={handleZoomGestureStart}
            onZoomGestureEnd={handleZoomGestureEnd}
            onTransformChange={setCt}
            notifyTransformDuringGesture
            transformNotifyIntervalMs={svgNodeMode ? 180 : 80}
            notifyScaleDuringGesture={!svgNodeMode}
            contentWidth={SURFACE_W}
            contentHeight={SURFACE_H}
          >
            <View style={{ width: SURFACE_W, height: SURFACE_H }}>
              <Svg
                width={SURFACE_W}
                height={SURFACE_H}
                viewBox={VIEWBOX}
                style={{ position: "absolute", top: 0, left: 0 }}
              >
                <Defs>
                  <Pattern
                    id="dotGridMinor"
                    patternUnits="userSpaceOnUse"
                    width={DOT_GRID_SMALL}
                    height={DOT_GRID_SMALL}
                  >
                    <Circle cx={DOT_GRID_SMALL / 2} cy={DOT_GRID_SMALL / 2} r={1.3} fill={dotMinor} />
                  </Pattern>
                  <Pattern
                    id="dotGridMajor"
                    patternUnits="userSpaceOnUse"
                    width={DOT_GRID_LARGE}
                    height={DOT_GRID_LARGE}
                  >
                    <Circle cx={DOT_GRID_LARGE / 2} cy={DOT_GRID_LARGE / 2} r={2} fill={dotMajor} />
                  </Pattern>
                </Defs>

                <Rect
                  x={-WORLD_W / 2}
                  y={-WORLD_H / 2}
                  width={WORLD_W}
                  height={WORLD_H}
                  fill={backgroundBase}
                />
                {showDotGrid ? (
                  <>
                    <Rect
                      x={-WORLD_W / 2}
                      y={-WORLD_H / 2}
                      width={WORLD_W}
                      height={WORLD_H}
                      fill="url(#dotGridMinor)"
                    />
                    <Rect
                      x={-WORLD_W / 2}
                      y={-WORLD_H / 2}
                      width={WORLD_W}
                      height={WORLD_H}
                      fill="url(#dotGridMajor)"
                    />
                  </>
                ) : null}
                <Rect
                  x={-WORLD_W / 2}
                  y={-WORLD_H / 2}
                  width={WORLD_W}
                  height={WORLD_H}
                  fill="transparent"
                  onPress={Platform.OS === "android" ? undefined : handleCanvasPress}
                />

                {kreslitObsah ? stromHrany.map(({ id, parentNode, childNode }) => (
                  <EdgeView
                    key={id}
                    from={{ x: parentNode.x, y: parentNode.y }}
                    to={{ x: childNode.x, y: childNode.y }}
                    points={routedTreeEdges[id]?.points}
                    edgeStyle={childNode.edgeToParent?.style ?? "solid"}
                    width={childNode.edgeToParent?.width ?? 2}
                    color={childNode.edgeToParent?.color ?? "#9ca3af"}
                    endArrow
                    endArrowTargetBounds={estimateNodeHalfBounds(childNode, childNode.id === map.rootId)}
                  />
                )) : null}

                {kreslitObsah ? vztahHrany.map((edge) => {
                  const fromNode = map.nodes[edge.fromId];
                  const toNode = map.nodes[edge.toId];
                  if (!fromNode || !toNode) {
                    return null;
                  }
                  const points = smartRelationshipRoutes
                    ? rre[edge.id]?.points ?? [fromNode, toNode]
                    : jednoducheTrasyVztahov[edge.id]?.points ?? [fromNode, toNode];

                  return (
                    <EdgeView
                      key={edge.id}
                      from={{ x: fromNode.x, y: fromNode.y }}
                      to={{ x: toNode.x, y: toNode.y }}
                      points={points}
                      edgeStyle={edge.style ?? "dashed"}
                      width={edge.width ?? 2}
                      color={
                        smartRelationshipRoutes
                          ? farbyVztahov[edge.id] ?? edge.color ?? "#94a3b8"
                          : RELATIONSHIP_LINK_COLOR
                      }
                      selected={seid === edge.id}
                      onPress={svgNodeMode ? undefined : () => handleSelectRelationshipEdge(edge.id)}
                      onLongPress={svgNodeMode ? undefined : () => handleLongPressRelationshipEdge(edge.id)}
                      hitSlopWidth={svgNodeMode ? 0 : 20}
                    />
                  );
                }) : null}

                {kreslitObsah && svgNodeMode ? kresleneUzly.map(renderSvgNode) : null}
              </Svg>

              {kreslitObsah && svgNodeMode && !rpId ? (
                <View style={{ position: "absolute", top: 0, left: 0, width: SURFACE_W, height: SURFACE_H }} pointerEvents="box-none">
                  {kresleneUzly.map(renderLargeNodeHitbox)}
                </View>
              ) : null}

              {kreslitObsah && !svgNodeMode ? (
                <View style={{ position: "absolute", top: 0, left: 0, width: SURFACE_W, height: SURFACE_H }} pointerEvents="box-none">
                  {kresleneUzly.map((node) => (
                    <EditableNodeView
                      key={node.id}
                      node={node}
                      worldWidth={SURFACE_W}
                      worldHeight={SURFACE_H}
                      isRoot={node.id === map.rootId}
                      selected={node.id === sid}
                      shape={node.shape}
                      placementMode={rpId === node.id}
                      linkMode={lm}
                      changeParentMode={cpm}
                      onSelect={handleSelectNode}
                      onSelectLinkTarget={handleSelectLinkTarget}
                      onSelectChangeParentTarget={handleSelectChangeParentTarget}
                      onStartReposition={handleStartReposition}
                    />
                  ))}
                </View>
              ) : null}
            </View>
          </ZoomableCanvas>

          {!lm && !cpm && !selectedEdge && !rpId ? (
            <View style={[ui.topOverlay, isLandscape && ui.topOverlayLandscape]}>
              <View style={[ui.topRow, isLandscape && ui.topRowLandscape]}>
                <View style={[ui.searchPanel, isLandscape && ui.searchPanelLandscape]}>
                  <TextInput
                    value={q}
                    onChangeText={setQ}
                    placeholder={t("map.searchPlaceholder")}
                    placeholderTextColor="#94a3b8"
                    style={[ui.searchInput, isDark && ui.searchInputDark]}
                    returnKeyType="search"
                  />
                </View>
                <View style={[ui.topActions, isLandscape && ui.topActionsLandscape]}>
                  {selectedNode ? (
                    <Pressable
                      onPress={addChildToSelected}
                      style={({ pressed }) => [
                        ui.actionButton,
                        isLandscape && ui.actionButtonLandscape,
                        ui.primaryButton,
                        pressed && ui.pressed,
                      ]}
                    >
                      <Text style={[ui.primaryButtonText, isLandscape && ui.primaryButtonTextLandscape]}>＋</Text>
                    </Pressable>
                  ) : null}
                  {selectedNode ? (
                    <Pressable
                      onPress={startLinkMode}
                      style={({ pressed }) => [
                        ui.actionButton,
                        isLandscape && ui.actionButtonLandscape,
                        ui.secondaryButton,
                        isDark && ui.secondaryButtonDark,
                        pressed && ui.pressed,
                      ]}
                    >
                      <Text style={[ui.secondaryButtonText, isLandscape && ui.secondaryButtonTextLandscape, isDark && ui.secondaryButtonTextDark]}>
                        {t("map.link")}
                      </Text>
                    </Pressable>
                  ) : null}
                  {selectedNode && selectedNode.id !== map.rootId ? (
                    <Pressable
                      onPress={startChangeParentMode}
                      style={({ pressed }) => [
                        ui.actionButton,
                        isLandscape && ui.actionButtonLandscape,
                        ui.secondaryButton,
                        isDark && ui.secondaryButtonDark,
                        pressed && ui.pressed,
                      ]}
                    >
                      <Text style={[ui.secondaryButtonText, isLandscape && ui.secondaryButtonTextLandscape, isDark && ui.secondaryButtonTextDark]}>
                        {t("map.changeParent")}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
              {hladaneTrim ? (
                <View style={[ui.searchResults, isDark && ui.searchResultsDark, isLandscape && ui.searchResultsLandscape]}>
                  {vysledkyHladania.length === 0 ? (
                    <Text style={[ui.searchEmpty, isDark && ui.searchEmptyDark]}>{t("map.noMatchingNodes")}</Text>
                  ) : (
                    vysledkyHladania.map(({ node, subtitle }) => (
                      <Pressable
                        key={node.id}
                        onPress={() => handleSelectSearchResult(node.id)}
                        style={({ pressed }) => [
                          ui.searchResultItem,
                          isDark && ui.searchResultItemDark,
                          pressed && ui.pressed,
                        ]}
                      >
                        <Text style={[ui.searchResultTitle, isDark && ui.searchResultTitleDark]}>{node.title}</Text>
                        <Text style={[ui.searchResultMeta, isDark && ui.searchResultMetaDark]}>{subtitle}</Text>
                      </Pressable>
                    ))
                  )}
                </View>
              ) : null}
            </View>
          ) : null}

          {lm ? (
            <View style={[ui.banner, isLandscape && ui.bannerLandscape]}>
              <Text style={ui.bannerText}>{t("map.selectSecondNode")}</Text>
              <Pressable onPress={cancelLinkMode} style={({ pressed }) => [ui.bannerButton, pressed && ui.pressed]}>
                <Text style={ui.bannerButtonText}>{t("common.cancel")}</Text>
              </Pressable>
            </View>
          ) : null}

          {cpm ? (
            <View style={[ui.banner, isLandscape && ui.bannerLandscape]}>
              <Text style={ui.bannerText}>{t("map.selectNewParentNode")}</Text>
              <Pressable onPress={cancelChangeParentMode} style={({ pressed }) => [ui.bannerButton, pressed && ui.pressed]}>
                <Text style={ui.bannerButtonText}>{t("common.cancel")}</Text>
              </Pressable>
            </View>
          ) : null}

          {rpId ? (
            <View style={[ui.banner, isLandscape && ui.bannerLandscape]}>
              <Text style={ui.bannerText}>{t("map.tapWhereMoveNode")}</Text>
              <Pressable onPress={() => setRpId(null)} style={({ pressed }) => [ui.bannerButton, pressed && ui.pressed]}>
                <Text style={ui.bannerButtonText}>{t("common.cancel")}</Text>
              </Pressable>
            </View>
          ) : null}

          {selectedEdge ? (
            <View style={[ui.edgePanel, isDark && ui.edgePanelDark, isLandscape && ui.edgePanelLandscape]}>
              <View style={ui.edgePanelHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={[ui.edgePanelTitle, isDark && ui.edgePanelTitleDark]}>{t("map.relationship")}</Text>
                  <Text style={[ui.edgePanelMeta, isDark && ui.edgePanelMetaDark]}>
                    {(selectedEdgeFromNode?.title ?? t("common.unknown"))} → {(selectedEdgeToNode?.title ?? t("common.unknown"))}
                  </Text>
                </View>
                <Pressable onPress={deleteSelectedRelationshipEdge} style={({ pressed }) => [ui.deleteButton, pressed && ui.pressed]}>
                  <Text style={ui.deleteButtonText}>{t("map.deleteLink")}</Text>
                </Pressable>
              </View>

              <View style={ui.edgePanelSection}>
                <Text style={[ui.edgePanelLabel, isDark && ui.edgePanelLabelDark]}>{t("map.style")}</Text>
                <View style={ui.edgePills}>
                  {([
                    { key: "solid", label: t("map.solid") },
                    { key: "dashed", label: t("map.dashed") },
                  ] as const).map((item) => {
                    const active = (selectedEdge.style ?? "dashed") === item.key;
                    return (
                      <Pressable
                        key={item.key}
                        onPress={() => updateSelectedRelationshipEdge({ style: item.key })}
                        style={({ pressed }) => [
                          ui.edgePill,
                          isDark && ui.edgePillDark,
                          active && ui.edgePillActive,
                          pressed && ui.pressed,
                        ]}
                      >
                        <Text style={[ui.edgePillText, isDark && ui.edgePillTextDark, active && ui.edgePillTextActive]}>{item.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View style={ui.edgePanelSection}>
                <Text style={[ui.edgePanelLabel, isDark && ui.edgePanelLabelDark]}>{t("map.width")}</Text>
                <View style={ui.edgeStepper}>
                  <Pressable
                    onPress={() =>
                      updateSelectedRelationshipEdge({
                        width: Math.max(1, (selectedEdge.width ?? 2) - 1),
                      })
                    }
                    style={({ pressed }) => [ui.edgeStepButton, isDark && ui.edgeStepButtonDark, pressed && ui.pressed]}
                  >
                    <Text style={[ui.edgeStepButtonText, isDark && ui.edgeStepButtonTextDark]}>−</Text>
                  </Pressable>
                  <Text style={[ui.edgeStepValue, isDark && ui.edgeStepValueDark]}>{selectedEdge.width ?? 2}</Text>
                  <Pressable
                    onPress={() =>
                      updateSelectedRelationshipEdge({
                        width: Math.min(10, (selectedEdge.width ?? 2) + 1),
                      })
                    }
                    style={({ pressed }) => [ui.edgeStepButton, isDark && ui.edgeStepButtonDark, pressed && ui.pressed]}
                  >
                    <Text style={[ui.edgeStepButtonText, isDark && ui.edgeStepButtonTextDark]}>＋</Text>
                  </Pressable>
                </View>
              </View>

              <View style={ui.edgePanelSection}>
                <Text style={[ui.edgePanelLabel, isDark && ui.edgePanelLabelDark]}>{t("map.color")}</Text>
                <View style={ui.edgePalette}>
                  {EDGE_PALETTE.map((color) => {
                    const active = (selectedEdge.color ?? DEFAULT_RELATIONSHIP_EDGE.color) === color;
                    return (
                      <Pressable
                        key={color}
                        onPress={() => updateSelectedRelationshipEdge({ color })}
                        style={({ pressed }) => [
                          ui.edgeSwatch,
                          { backgroundColor: color },
                          active && ui.edgeSwatchActive,
                          pressed && ui.pressed,
                        ]}
                      />
                    );
                  })}
                </View>
              </View>
            </View>
          ) : null}

          {zh ? (
            <View style={[ui.zoomHud, isLandscape && ui.zoomHudLandscape]}>
              <Text style={ui.zoomHudText}>{Math.round(z * 100)}%</Text>
            </View>
          ) : null}

          {mt ? (
            <View style={[ui.moveToast, isLandscape && ui.moveToastLandscape]}>
              <Text style={ui.moveToastText}>{mt}</Text>
            </View>
          ) : null}

          {mb ? (
            <View style={[ui.mapLoadOverlay, isDark && ui.mapLoadOverlayDark]}>
              <View style={[ui.mapLoadCard, isDark && ui.mapLoadCardDark, isLandscape && ui.mapLoadCardLandscape]}>
                <View style={ui.mapLoadProgressHeader}>
                  <Text style={[ui.mapLoadProgressTitle, isDark && ui.mapLoadProgressTitleDark]}>
                    {t("map.movingNode")}
                  </Text>
                  <ActivityIndicator color="#0ea5e9" />
                </View>
              </View>
            </View>
          ) : ukazPostupMapy ? (
            <View style={[ui.mapLoadOverlay, isDark && ui.mapLoadOverlayDark]}>
              <View style={[ui.mapLoadCard, isDark && ui.mapLoadCardDark, isLandscape && ui.mapLoadCardLandscape]}>
                <View style={ui.mapLoadProgressHeader}>
                  <Text style={[ui.mapLoadProgressTitle, isDark && ui.mapLoadProgressTitleDark]}>
                    {t("map.loadingMap")}
                  </Text>
                  <Text style={[ui.mapLoadProgressPercent, isDark && ui.mapLoadProgressPercentDark]}>
                    {postupMapy}%
                  </Text>
                </View>
                <View style={[ui.mapLoadProgressTrack, isDark && ui.mapLoadProgressTrackDark]}>
                  <View style={[ui.mapLoadProgressFill, { width: `${postupMapy}%` }]} />
                </View>
              </View>
            </View>
          ) : null}
        </View>

        {shouldShowInspector ? (
          <NodeInspector
            mode={isLandscape ? "side" : "sheet"}
            sideWidth={inspectorSideWidth}
            node={selectedNode}
            nodes={map.nodes}
            edges={map.edges}
            onClose={() => setSid(null)}
            onUpdateTitle={updateTitle}
            onUpdateNote={updateNote}
            onUpdateTags={updateTags}
            onUpdateDueAt={updateDueAt}
            onAddAttachment={addAttachment}
            onRemoveAttachment={removeAttachment}
            onUpdateCollapsed={updateCollapsed}
            onUpdateColor={updateColor}
            onUpdateSize={updateSize}
            onUpdateShape={updateShape}
            onUpdateEdge={updateEdge}
            onHeight={isLandscape ? () => {} : setIh}
            onSelectNode={handleSelectNode}
            onDeleteConnection={deleteConnection}
            onDeleteNode={deleteNode}
          />
        ) : null}
      </View>
    </View>
  );
}
