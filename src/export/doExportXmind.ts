import JSZip from "jszip";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

import { MindMap } from "../types/map";
import { exportToXmindZenContentJson } from "./xmind";

import manifestJson from "./templates/manifest.json";
import metadataJson from "./templates/metadata.json";

function safeFileName(name: string) {
  return (name || "mind-map")
    .replace(/[\\/:*?"<>|]/g, "-")
    .trim()
    .slice(0, 60);
}

export async function exportXmind(map: MindMap): Promise<void> {
  const baseDir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
  if (!baseDir) {
    throw new Error("FileSystem cache/document directory is not available");
  }

  // 1) Build content.json for modern XMind (JSON-based format)
  const contentJson = exportToXmindZenContentJson(map);

  // 2) Assemble .xmind (zip container)
  const zip = new JSZip();
  zip.file("content.json", contentJson);
  zip.file("manifest.json", JSON.stringify(manifestJson, null, 2));
  zip.file("metadata.json", JSON.stringify(metadataJson, null, 2));

  const zipBase64 = await zip.generateAsync({ type: "base64" });

  // 3) Write file to app documents
  const fileName = `${safeFileName(map.title)}-${map.id}.xmind`;
  const outUri = baseDir.endsWith("/") ? baseDir + fileName : baseDir + "/" + fileName;

  await FileSystem.writeAsStringAsync(outUri, zipBase64, {
    // Legacy FileSystem supports base64 for binary blobs.
    encoding: FileSystem.EncodingType.Base64,
  });

  // 4) Share / Save to Files
  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) {
    throw new Error("Sharing is not available on this device");
  }

  await Sharing.shareAsync(outUri, {
    mimeType: "application/octet-stream",
    UTI: "com.xmind.xmind",
    dialogTitle: "Export XMind",
  });
}