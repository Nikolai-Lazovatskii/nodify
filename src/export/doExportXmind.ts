/**
 * Súbor: src/export/doExportXmind.ts
 * Abstrakt: Vytvára súbor XMind a spúšťa zdieľanie alebo uloženie exportu v systéme.
 */
import JSZip from "jszip";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

import { MindMap } from "../types/map";
import { exportToNodifyXmindMetadataJson, exportToXmindZenContentJson } from "./xmind";

import manifestJson from "./templates/manifest.json";
import metadataJson from "./templates/metadata.json";

function safeFileName(name: string) {
  return (name || "mind-map")
    .replace(/[\\/:*?"<>|]/g, "-")
    .trim()
    .slice(0, 60);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function buildManifest(rawManifest: unknown, hasNodifyMetadata: boolean) {
  const manifest = isRecord(rawManifest) ? clone(rawManifest) : clone(manifestJson);

  if (hasNodifyMetadata) {
    const entries = isRecord(manifest["file-entries"]) ? { ...manifest["file-entries"] } : {};
    entries["nodify-metadata.json"] = {};
    manifest["file-entries"] = entries;
  }

  return manifest;
}

export async function exportXmind(map: MindMap, dialogTitle = "Export XMind"): Promise<void> {
  const baseDir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
  if (!baseDir) {
    throw new Error("FileSystem cache/document directory is not available");
  }

  const contentJson = exportToXmindZenContentJson(map);
  const nodifyMetadataJson = exportToNodifyXmindMetadataJson(map);

  const zip = new JSZip();
  const rawManifest = map.importedFormat?.vendor?.xmind?.rawManifest;
  const rawMetadata = map.importedFormat?.vendor?.xmind?.rawMetadata;
  zip.file("content.json", contentJson);
  zip.file("manifest.json", JSON.stringify(buildManifest(rawManifest, !!nodifyMetadataJson), null, 2));
  zip.file("metadata.json", JSON.stringify(rawMetadata ?? metadataJson, null, 2));
  if (nodifyMetadataJson) {
    zip.file("nodify-metadata.json", nodifyMetadataJson);
  }

  const zipBase64 = await zip.generateAsync({ type: "base64" });

  const fileName = `${safeFileName(map.title)}-${map.id}.xmind`;
  const outUri = baseDir.endsWith("/") ? baseDir + fileName : baseDir + "/" + fileName;

  await FileSystem.writeAsStringAsync(outUri, zipBase64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) {
    throw new Error("Sharing is not available on this device");
  }

  await Sharing.shareAsync(outUri, {
    mimeType: "application/octet-stream",
    UTI: "com.xmind.xmind",
    dialogTitle,
  });
}
