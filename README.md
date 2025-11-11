# Nodify 🧠

Nodify is a cross-platform mobile application for creating, editing, and visualizing mind maps.

This project is being developed as part of a bachelor thesis at **Comenius University in Bratislava**. The main focus is:

- support for the widely used mind map formats **XMind (.xmind)** and **FreeMind (.mm)**,
- interoperability between desktop tools and a mobile client,
- modern, touch-friendly user interface with smooth interactions,
- offline-first approach with the option to add cloud synchronization across devices.

The goal is to provide a practical tool that allows users to:

- open existing mind maps created in other applications,
- work with them on mobile devices,
- and save them back in compatible formats without losing the core structure of the map.

---

## Tech Stack

Nodify is built with:

- **React Native** + **Expo** – cross-platform app for Android and iOS
- **TypeScript** – type safety and maintainable codebase
- **Expo Router** – file-based navigation
- **react-native-svg** – rendering of nodes and connections
- **react-native-gesture-handler** / **Reanimated** (planned) – pan, zoom, drag, interactions
- **AsyncStorage / SQLite** (planned) – local offline storage
- **Firebase / Supabase / custom backend** (planned) – cloud synchronization

---

## How to Run

\`\`\`bash
npm install
npx expo start
\`\`\`

You can run the app using:

- **Expo Go** on a physical device
- **Android** or **iOS** simulator

Make sure you have Node.js and the Expo tooling installed.

---

## Current Status (MVP Prototype)

The current version represents an early MVP foundation:

- base Expo project with clear structure (\\`app/\\`, \\`src/\\`),
- internal data model for mind maps (\\`MindMap\\`, \\`MindMapNode\\`),
- basic SVG visualization of a sample mind map based on this model,
- prepared architecture for:
  - node interaction (selection, editing),
  - pan &amp; zoom (to be implemented),
  - import/export of \\`.mm\\` (FreeMind) and \\`.xmind\\` (XMind) (to be implemented).

This repository serves both as:

- the **practical implementation** for the bachelor thesis, and
- a **starting point** for further development into a production-ready mind map editor.

---

## Project Roadmap

1. **Mind map editor core**
   - adding, editing, and deleting nodes,
   - basic automatic layout around the root node.

2. **Interoperability**
   - export to **FreeMind (.mm)** and JSON-based **XMind** format,
   - preserving core tree structure between tools.

3. **Storage &amp; Sync**
   - offline storage on device (AsyncStorage / SQLite),
   - optional cloud sync (Firebase / Supabase / custom backend).

4. **UX &amp; Extensions**
   - improved visuals (themes, colors, icons),
   - smooth gestures (pan, zoom, drag),
   - foundations for future AI-assisted features.

---

## Bachelor Thesis Context

This repository is part of the practical implementation of a bachelor thesis at **Comenius University in Bratislava**.

The thesis focuses on:

- analysis of XMind and FreeMind and their file formats,
- design of a mobile application enabling interoperability between these formats,
- implementation of an MVP demonstrating visualization and internal data structures,
- outlining further steps towards a fully usable cross-platform mind map editor.

---

## Public API Documentation

This section documents the main public types and components currently exposed inside the project.  
It is intended for contributors and for the thesis documentation.

### Type: \`MindMapNode\`

**Location:** \`src/types/Map.ts\` (or equivalent)

Represents a single node (topic) in a mind map.

**Fields:**

- \`id: string\`  
  Unique identifier of the node.

- \`parentId: string | null\`  
  Identifier of the parent node. \`null\` for the root node.

- \`title: string\`  
  Text label shown in the node.

- \`x: number\`, \`y: number\`  
  Relative coordinates of the node within the logical map layout (used by the renderer).

- \`children: string[]\`  
  List of identifiers of direct child nodes.

**Usage:**

- Forms the basic tree structure of the map.
- Used by rendering components to resolve relationships and positions.

---

### Type: \`MindMap\`

**Location:** \`src/types/Map.ts\` (or equivalent)

Represents an entire mind map document.

**Fields:**

- \`id: string\`  
  Unique identifier of the map.

- \`title: string\`  
  Human-readable name of the map.

- \`rootId: string\`  
  Identifier of the root node (must correspond to a key in \`nodes\`).

- \`nodes: Record&lt;string, MindMapNode&gt;\`  
  Dictionary of all nodes in the map, indexed by node id.

**Usage:**

- Acts as the in-memory model for visualization,
- Serves as the source structure for future import/export to FreeMind (.mm) and XMind (.xmind).

---

### Component: \`MindMapCanvas\`

**Location:** \`src/components/MindMapCanvas.tsx\`

Responsible for visual rendering of a given \`MindMap\` using SVG.

**Props:**

- \`map: MindMap\` (required)  
  Map data to be rendered.

**Behavior:**

- Computes positioned nodes (absolute coordinates) from the logical model.
- Draws:
  - connecting lines between parent and child nodes,
  - circular nodes for topics,
  - text labels for each node.
- Designed to be extended with:
  - interactive node selection,
  - hover/tap feedback,
  - pan and zoom transformations.

**Notes:**

- Uses \`react-native-svg\` for all graphical elements.
- Keeps rendering concerns separate from application state and navigation.

---

### Screen: \`MapScreen\`

**Location:** \`src/screens/MapScreen.tsx\`

Top-level screen showing a mind map inside the app.

**Responsibilities:**

- Provides a sample \`MindMap\` (mock data) during the MVP phase.
- Renders:
  - page title and basic textual information,
  - the \`MindMapCanvas\` component with given map data.
- In later stages will:
  - manage selected node state,
  - integrate editing controls (add/delete/rename),
  - load and save maps from persistent storage.

**Export:**

- Default export of the module, used by Expo Router as one of the main screens.

---

## Slovak Summary

Nodify je multiplatformová mobilná aplikácia určená na tvorbu, úpravu a vizualizáciu myšlienkových máp, vyvíjaná ako súčasť bakalárskej práce na Univerzite Komenského v Bratislave. Cieľom je podporovať formáty **XMind (.xmind)** a **FreeMind (.mm)**, zlepšiť interoperabilitu medzi desktopovými nástrojmi a mobilnou aplikáciou, umožniť offline prácu a pripraviť priestor pre budúcu cloudovú synchronizáciu. Aktuálna verzia predstavuje MVP zamerané na dátový model, základnú vizualizáciu a návrh architektúry pre ďalší rozvoj aplikácie.

