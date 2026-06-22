/**
 * Súbor: src/export/doExportMm.ts
 * Abstrakt: Vytvára súbor FreeMind a voliteľný ZIP balík s prílohami pre prenos medzi zariadeniami.
 */
import JSZip from "jszip";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

import { MindMap, NodeAttachment } from "../types/map";
import { exportToMm } from "./mm";

type PackagedAttachment = {
  zipPath: string;
  data: string;
  options?: {
    base64?: boolean;
  };
};

type AttachmentReadFailure = {
  name: string;
};

function safeFileName(name: string) {
  return (name || "mind-map")
    .replace(/[\\/:*?"<>|]/g, "-")
    .trim()
    .slice(0, 60);
}

function joinUri(baseUri: string, fileName: string) {
  return baseUri.endsWith("/") ? `${baseUri}${fileName}` : `${baseUri}/${fileName}`;
}

function safeAttachmentName(attachment: NodeAttachment, fallback: string) {
  const rawName = attachment.name?.trim() || fallback;
  return rawName.replace(/[\\/:*?"<>|]/g, "-").trim() || fallback;
}

function isDataUri(uri: string) {
  return /^data:/i.test(uri);
}

function isRemoteUri(uri: string) {
  return /^https?:\/\//i.test(uri);
}

function isLocalFileUri(uri: string) {
  return /^(file|content):\/\//i.test(uri) || uri.startsWith("/");
}

function isPackageableAttachmentUri(uri: string) {
  const trimmed = uri.trim();
  return !!trimmed && !isRemoteUri(trimmed) && (isDataUri(trimmed) || isLocalFileUri(trimmed));
}

function uniqueZipPath(baseName: string, usedPaths: Set<string>) {
  const folder = "attachments";
  const cleaned = safeFileName(baseName) || "attachment";
  const dotIndex = cleaned.lastIndexOf(".");
  const stem = dotIndex > 0 ? cleaned.slice(0, dotIndex) : cleaned;
  const ext = dotIndex > 0 ? cleaned.slice(dotIndex) : "";

  let candidate = `${folder}/${cleaned}`;
  let index = 2;
  while (usedPaths.has(candidate)) {
    candidate = `${folder}/${stem}-${index}${ext}`;
    index += 1;
  }
  usedPaths.add(candidate);
  return candidate;
}

function parseDataUri(uri: string): { data: string; base64: boolean } | null {
  const match = uri.match(/^data:([^;,]+)?(;base64)?,(.*)$/i);
  if (!match) {
    return null;
  }

  return {
    data: match[3] ?? "",
    base64: !!match[2],
  };
}

async function readAttachmentData(uri: string, attachmentId: string) {
  if (isDataUri(uri)) {
    const parsed = parseDataUri(uri);
    if (!parsed) {
      throw new Error(`Invalid data attachment: ${attachmentId}`);
    }

    return {
      data: parsed.base64 ? parsed.data : decodeURIComponent(parsed.data),
      options: parsed.base64 ? { base64: true } : undefined,
    };
  }

  return {
    data: await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    }),
    options: { base64: true },
  };
}

async function buildPortableMap(map: MindMap): Promise<{
  map: MindMap;
  attachments: PackagedAttachment[];
  failures: AttachmentReadFailure[];
}> {
  const portableMap = JSON.parse(JSON.stringify(map)) as MindMap;
  const attachments: PackagedAttachment[] = [];
  const failures: AttachmentReadFailure[] = [];
  const usedPaths = new Set<string>();

  for (const node of Object.values(portableMap.nodes)) {
    const nextAttachments: NodeAttachment[] = [];

    for (const [index, attachment] of (node.attachments ?? []).entries()) {
      const sourceUri = attachment.uri?.trim();
      if (!sourceUri || !isPackageableAttachmentUri(sourceUri)) {
        nextAttachments.push(attachment);
        continue;
      }

      const zipPath = uniqueZipPath(
        safeAttachmentName(attachment, `${node.id}-attachment-${index + 1}`),
        usedPaths
      );
      let payload: { data: string; options?: { base64?: boolean } };
      try {
        payload = await readAttachmentData(sourceUri, attachment.id);
      } catch {
        failures.push({ name: attachment.name?.trim() || attachment.id || sourceUri });
        nextAttachments.push(attachment);
        continue;
      }

      attachments.push({
        zipPath,
        ...payload,
      });

      nextAttachments.push({
        ...attachment,
        uri: zipPath,
      });
    }

    node.attachments = nextAttachments.length > 0 ? nextAttachments : undefined;
  }

  return { map: portableMap, attachments, failures };
}

export async function exportMm(map: MindMap, dialogTitle = "Export FreeMind"): Promise<void> {
  const baseDir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
  if (!baseDir) {
    throw new Error("FileSystem cache/document directory is not available");
  }

  const fileBaseName = `${safeFileName(map.title)}-${map.id}`;
  const portable = await buildPortableMap(map);
  if (portable.failures.length > 0) {
    const names = portable.failures.map((failure) => failure.name).join(", ");
    throw new Error(`Some attached files are no longer readable. Reattach them and export again: ${names}`);
  }

  const xml = exportToMm(portable.map);
  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) {
    throw new Error("Sharing is not available on this device");
  }

  if (portable.attachments.length === 0) {
    const outUri = joinUri(baseDir, `${fileBaseName}.mm`);
    await FileSystem.writeAsStringAsync(outUri, xml, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    await Sharing.shareAsync(outUri, {
      mimeType: "text/xml",
      dialogTitle,
      UTI: "public.xml",
    });
    return;
  }

  const zip = new JSZip();
  zip.file(`${fileBaseName}.mm`, xml);
  for (const attachment of portable.attachments) {
    zip.file(attachment.zipPath, attachment.data, attachment.options);
  }

  const zipBase64 = await zip.generateAsync({ type: "base64" });
  const outUri = joinUri(baseDir, `${fileBaseName}-freemind.zip`);
  await FileSystem.writeAsStringAsync(outUri, zipBase64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  await Sharing.shareAsync(outUri, {
    mimeType: "application/zip",
    dialogTitle,
    UTI: "public.zip-archive",
  });
}
