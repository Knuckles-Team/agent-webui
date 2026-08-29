# Atlas workspace

Atlas (`/explore`) is the single top-level entry for Knowledge in Agent WebUI. It
provides one place to choose a modality, filter a result, and switch between the
renderers that can honestly draw it.

## Progressive disclosure

The Atlas page starts with guided entry points for common questions such as finding
documents, browsing objects, understanding the schema, and seeing connected things.
The unified workbench remains available below those starting points. Specialist
surfaces live under the collapsed **Expert tools** section when they need controls that
do not belong in the modality-neutral workbench.

The global sidebar therefore shows one **Atlas** item under Knowledge. Existing
specialist URLs (`/graph`, `/graph-3d`, `/temporal-graph`, `/explorer`, `/knowledge`,
and the other registered Knowledge paths) remain registered and bookmarkable. The
sidebar keeps Atlas active while one of those expert or object deep-link routes is open.
Role filtering applies to both the sidebar and the Atlas index.

On narrow screens, Atlas exposes **Sources** and **Selection details** as keyboard-
operable disclosures instead of removing those panels. The workbench's 3D renderer
may still decline when the device cannot support it; the table, JSON, and compatible
2D renderers remain available.

Navigation placement is declared in `src/lib/nav-registry.ts`:

- `primary` routes appear in the global sidebar;
- `atlas` routes are linked from Atlas's expert index and remain directly reachable;
- `deep-link` routes are reached from selections or other capability flows.

This is an information-architecture change, not a claim that every epistemic-graph
backend modality is already implemented. Adapter capabilities and unavailable-source
messages remain the source of truth for what Atlas can answer today.
