/**
 * Súbor: src/screens/mapScreen/canvasGeometry.ts
 * Abstrakt: Počíta rozmery plátna, hranice mapy a prevody súradníc editora.
 */
import { useCallback, useMemo } from "react";
import { PixelRatio, Platform } from "react-native";

import type { CanvasTransform } from "@/src/components/ZoomableCanvas";
import type { MindMapNode } from "@/src/types/map";

import { PROGRESSIVE_RENDER_NODE_LIMIT } from "./constants";
import { estimateNodeHalfBounds } from "./routing";

export type WorldViewport = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export function viewportContainsNode(viewport: WorldViewport, node: MindMapNode, isRoot: boolean) {
  const { halfW, halfH } = estimateNodeHalfBounds(node, isRoot);
  return (
    node.x + halfW >= viewport.left &&
    node.x - halfW <= viewport.right &&
    node.y + halfH >= viewport.top &&
    node.y - halfH <= viewport.bottom
  );
}

export function makeWorldViewport(
  transform: CanvasTransform,
  paddingMultiplier = 1.25,
  worldWidth = transform.width,
  worldHeight = transform.height,
  surfaceWidth = transform.width,
  surfaceHeight = transform.height
): WorldViewport {
  const safeScale = transform.scale || 1;
  const scaleX = worldWidth / Math.max(1, surfaceWidth);
  const scaleY = worldHeight / Math.max(1, surfaceHeight);
  const left = ((0 - transform.width / 2 - transform.tx) / safeScale) * scaleX;
  const right = ((transform.width - transform.width / 2 - transform.tx) / safeScale) * scaleX;
  const top = ((0 - transform.height / 2 - transform.ty) / safeScale) * scaleY;
  const bottom = ((transform.height - transform.height / 2 - transform.ty) / safeScale) * scaleY;
  const padX = ((right - left) || transform.width) * paddingMultiplier;
  const padY = ((bottom - top) || transform.height) * paddingMultiplier;

  return {
    left: left - padX,
    right: right + padX,
    top: top - padY,
    bottom: bottom + padY,
  };
}

export function getNodeRenderBounds(node: MindMapNode, isRoot: boolean) {
  const { halfW, halfH } = estimateNodeHalfBounds(node, isRoot);
  return {
    width: halfW * 2,
    height: halfH * 2,
    x: node.x - halfW,
    y: node.y - halfH,
  };
}

export function getMapBounds(nodes: MindMapNode[], rootId: string) {
  if (nodes.length === 0) {
    return { left: 0, right: 0, top: 0, bottom: 0, width: 1, height: 1, centerX: 0, centerY: 0 };
  }

  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;

  for (const node of nodes) {
    const { halfW, halfH } = estimateNodeHalfBounds(node, node.id === rootId);
    left = Math.min(left, node.x - halfW);
    right = Math.max(right, node.x + halfW);
    top = Math.min(top, node.y - halfH);
    bottom = Math.max(bottom, node.y + halfH);
  }

  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);

  return {
    left,
    right,
    top,
    bottom,
    width,
    height,
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2,
  };
}

type UseMapCanvasMetricsParams = {
  nodes: MindMapNode[];
  rootId: string;
  totalNodeCount: number;
  screenW: number;
  screenH: number;
  isLandscape: boolean;
  transform: CanvasTransform;
};

export function useMapCanvasMetrics({
  nodes,
  rootId,
  totalNodeCount,
  screenW,
  screenH,
  isLandscape,
  transform,
}: UseMapCanvasMetricsParams) {
  const useCappedSurface = totalNodeCount >= PROGRESSIVE_RENDER_NODE_LIMIT;
  const worldReach = useMemo(() => {
    if (nodes.length === 0) {
      return { maxX: 0, maxY: 0 };
    }

    let maxReachX = 0;
    let maxReachY = 0;

    for (const node of nodes) {
      const { halfW, halfH } = estimateNodeHalfBounds(node, node.id === rootId);
      maxReachX = Math.max(maxReachX, Math.abs(node.x) + halfW);
      maxReachY = Math.max(maxReachY, Math.abs(node.y) + halfH);
    }

    return {
      maxX: maxReachX,
      maxY: maxReachY,
    };
  }, [nodes, rootId]);

  const androidSurfaceCap = Math.max(2400, Math.round(8200 / PixelRatio.get()));
  const largeSurfaceCap = Platform.OS === "android" ? androidSurfaceCap : 9000;
  const worldPaddingX = Math.max(isLandscape ? 520 : 460, screenW * (useCappedSurface ? 1.15 : 0.62));
  const worldPaddingY = Math.max(isLandscape ? 460 : 520, screenH * (useCappedSurface ? 1.1 : 0.52));
  const minWorldW = Math.max(1200, screenW * 1.6);
  const minWorldH = Math.max(1200, screenH * 1.6);
  const desiredWorldW = Math.round(Math.max(minWorldW, (worldReach.maxX + worldPaddingX) * 2));
  const desiredWorldH = Math.round(Math.max(minWorldH, (worldReach.maxY + worldPaddingY) * 2));
  const WORLD_W = useCappedSurface
    ? desiredWorldW
    : Platform.OS === "android"
      ? Math.min(androidSurfaceCap, desiredWorldW)
      : desiredWorldW;
  const WORLD_H = useCappedSurface
    ? desiredWorldH
    : Platform.OS === "android"
      ? Math.min(androidSurfaceCap, desiredWorldH)
      : desiredWorldH;
  const SURFACE_W = useCappedSurface ? Math.min(largeSurfaceCap, desiredWorldW) : WORLD_W;
  const SURFACE_H = useCappedSurface ? Math.min(largeSurfaceCap, desiredWorldH) : WORLD_H;
  const VIEWBOX = `${-WORLD_W / 2} ${-WORLD_H / 2} ${WORLD_W} ${WORLD_H}`;
  const mapBounds = useMemo(() => getMapBounds(nodes, rootId), [nodes, rootId]);
  const worldToSurfaceX = useCallback(
    (x: number) => x * (SURFACE_W / Math.max(1, WORLD_W)),
    [SURFACE_W, WORLD_W]
  );
  const worldToSurfaceY = useCallback(
    (y: number) => y * (SURFACE_H / Math.max(1, WORLD_H)),
    [SURFACE_H, WORLD_H]
  );
  const surfaceToWorldX = useCallback(
    (x: number) => x * (WORLD_W / Math.max(1, SURFACE_W)),
    [SURFACE_W, WORLD_W]
  );
  const surfaceToWorldY = useCallback(
    (y: number) => y * (WORLD_H / Math.max(1, SURFACE_H)),
    [SURFACE_H, WORLD_H]
  );
  const worldViewport = useMemo(
    () => makeWorldViewport(
      transform,
      totalNodeCount >= PROGRESSIVE_RENDER_NODE_LIMIT ? 4.5 : 0.35,
      WORLD_W,
      WORLD_H,
      SURFACE_W,
      SURFACE_H
    ),
    [WORLD_H, WORLD_W, SURFACE_H, SURFACE_W, totalNodeCount, transform]
  );

  return {
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
  };
}
