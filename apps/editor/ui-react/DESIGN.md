---
name: Note Harbor Editor
description: Warm, paper-toned local collection software for banknote archives
colors:
  harbor-paper: "#f3ecdf"
  shell-cream: "#fffaf1"
  sand-panel: "#faf4e8"
  header-sand: "#efe5d2"
  rail-handle: "#e5d8c0"
  walnut-ink: "#2e2318"
  umber: "#6f5c40"
  faded-umber: "#7a6749"
  harbor-brass: "#96622f"
  deep-brass: "#71461f"
  soft-brass: "#f6e7d2"
  harbor-green: "#2f6b3c"
  signal-red: "#a02a22"
  amber-warning: "#8a5a00"
  slate-info: "#40667c"
  night-harbor: "#201913"
  night-surface: "#2a2118"
  warm-linen: "#f7ecdc"
  brass-on-dark: "#e0aa62"
typography:
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", Inter, \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "1.4rem"
    fontWeight: 700
    lineHeight: 1.3
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", Inter, \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  data:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", Inter, \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.5
  code:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", Inter, \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    letterSpacing: "0.045em"
  meta:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", Inter, \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", Inter, \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "0.625rem"
    fontWeight: 650
    letterSpacing: "0.075em"
  wordmark:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", Inter, \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "13.5px"
    fontWeight: 800
    letterSpacing: "-0.01em"
rounded:
  sm: "8px"
  md: "10px"
  lg: "16px"
  xl: "20px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  section: "32px"
components:
  button-default:
    backgroundColor: "{colors.shell-cream}"
    textColor: "{colors.walnut-ink}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
    height: "34px"
  button-primary:
    backgroundColor: "{colors.deep-brass}"
    textColor: "{colors.shell-cream}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
    height: "34px"
  button-danger:
    backgroundColor: "{colors.signal-red}"
    textColor: "{colors.shell-cream}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
    height: "34px"
  filter-input:
    backgroundColor: "{colors.shell-cream}"
    textColor: "{colors.walnut-ink}"
    rounded: "{rounded.md}"
    padding: "6px 10px"
    height: "34px"
  table-shell:
    backgroundColor: "{colors.shell-cream}"
    textColor: "{colors.walnut-ink}"
    rounded: "{rounded.md}"
    padding: "0"
---

# Design System: Note Harbor Editor

## Overview

**Creative North Star: "The Curator's Desk"**

The Editor is a warm wooden desk under good light: cream paper, ink-brown text, and brass fittings. Every surface is tinted, never pure white, so a long cataloguing session reads as paper on a desk rather than a form on a screen. Color carries hierarchy sparingly — brass marks the active, the selected, and the primary action, and almost nothing else.

Structure is dense and quiet. The Table screen is the system's center of gravity: a single bordered card filling the viewport, a fixed 64px rail that expands on hover, compact 40px headers, and 12px cell padding tuned for scanning thousands of rows. Capture and Showcase screens reuse the same card, field, and button vocabulary at a lower density; nothing invents a second visual language.

The system has no logo-driven identity, no display face, and no decorative imagery. Personality comes from the warmth of the palette, the softness of the shadows, the rounded 8–20px geometry, and the precision of state changes. Restraint is the brief, not a limitation.

**Key Characteristics:**
- Warm paper neutrals (#f3ecdf → #fffaf1 → #efe5d2), never cold grey or pure white.
- One brass accent (#96622f / #71461f) used for state, selection, and primary action only.
- A single system sans across every role; hierarchy from size, weight, and letter-spacing.
- Dense, viewport-filling cards with 1px warm borders and soft, low-contrast shadows.
- Rounded geometry: 8–10px controls, 16–20px panels, pill-shaped bars and counters.

## Colors

A warm parchment-and-brass palette with four muted status hues, all low-chroma so data stays legible.

### Primary
- **Harbor Brass** (#96622f): The single accent. Focus rings, selected rows' edge, active sort labels, links, scrollbar hover, and the fill of the hover halo on checkboxes.
- **Deep Brass** (#71461f): The action color. Primary buttons, the bulk action pill, and emphasized links; darker than Harbor Brass so cream text clears contrast.
- **Soft Brass Wash** (rgba(150, 98, 47, 0.12)): Tinted grounds for hovered controls, active segments, and the selected-row field. The zebra stripe is the same hue at 0.05.
- **Brass on Dark** (#e0aa62): The accent's only appearance in the slideshow and overlay world, where the paper palette inverts.

### Neutral
- **Harbor Paper** (#f3ecdf): The app ground behind every card.
- **Shell Cream** (#fffaf1): Card and control surfaces; the lightest ground in the paper world.
- **Sand Panel** (#faf4e8): Secondary panels and striped sections.
- **Header Sand** (#efe5d2): Table headers and the one-step-darker band that separates chrome from content.
- **Rail Handle** (#e5d8c0): The deepest paper step, reserved for the reorder rail's hover.
- **Walnut Ink** (#2e2318): Primary text.
- **Umber** (#6f5c40): Secondary text, labels, and inactive navigation; measured to clear 4.5:1 on every paper ground.
- **Faded Umber** (#7a6749): Tertiary text such as the pinned version and group labels.
- **Night Harbor** (#201913): The overlay world's ground for slideshow and image popovers, with Warm Linen (#f7ecdc) as its text.

### Status
- **Harbor Green** (#2f6b3c) on rgba(47, 107, 60, 0.1): Success and saved states.
- **Signal Red** (#a02a22) on rgba(160, 42, 34, 0.08): Destructive actions and load errors.
- **Amber Warning** (#8a5a00) on rgba(168, 132, 40, 0.12): Warnings and scrape conflicts.
- **Slate Info** (#40667c) on rgba(64, 102, 124, 0.12): Informational callouts.

### Named Rules
**The Warm Paper Rule.** No surface is pure white and no text is pure black. The lightest ground is Shell Cream (#fffaf1) and the darkest ink is Walnut Ink (#2e2318); a cold grey is always a bug.

**The Brass Rarity Rule.** Brass covers at most about a tenth of any screen. Its rarity is what makes selection and the primary action read instantly.

## Typography

**Display Font:** none — the system uses no display face.
**Body Font:** the native UI stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, "Helvetica Neue", Arial, sans-serif`).
**Label/Mono Font:** the same stack, with `font-variant-numeric: tabular-nums` wherever numbers change in place.

**Character:** One family, worked hard. The Editor borrows the operating system's own voice so it feels native on every desktop, then builds hierarchy from weight and case rather than from a second typeface. Table headers in particular become a texture: tiny, wide-tracked, uppercase.

### Hierarchy
- **Title** (700, 1.4rem/1.3): Screen titles such as a Showcase Category name.
- **Panel heading** (700, ~1.05–1.15rem): Card and panel headings; the largest recurring text in the Table and Import screens.
- **Body** (400, 0.86–0.9rem/1.5): Field values and running copy.
- **Data** (400, 13.5px): Table cell values, the dense step of Body. Every cell carries `tabular-nums`, and weight, not size, separates the row's roles — Catalog # and Denomination at 600, the rest at 400.
- **Code** (500, 13px, 0.045em tracking): Serial numbers and other identifier strings in the Table, one step under Data so a long code never out-shouts the row's name.
- **Control** (600, 0.84rem/1.2): Buttons, links, and tabs.
- **Label** (650, 0.625rem, 0.075em tracking, uppercase): Table and menu headers, in Umber so 10px caps clear 4.5:1 on the header band. Group labels sit at 9.5px/800 with 0.14em tracking.
- **Meta** (400, 0.75rem/1.5, `tabular-nums`): The Table's footer summary and status lines, one step under the rail's 12px hint.
- **Micro** (600–800, 11–13.5px): Version footers, counters, and the wordmark.

### Named Rules
**The One Sans Rule.** Never introduce a display, serif, or mono family. Differences in weight, size, case, and tracking carry every distinction.

**The Tabular Rule.** Any number that can change in place — counters, positions, sizes — is set in `tabular-nums` so it never jitters.

## Layout

A fixed, non-scrolling app shell: a left sidebar dock plus a main column that fills the remaining width and height. The dock is a 64px rail whose contents expand over the content to a max of 288px on hover or keyboard focus; it never becomes a drawer and never pushes the main column at narrow widths. Main padding is 16px vertical and 24px horizontal; screens stack with 24px gaps.

The Table screen is one card that consumes the whole remaining area: a bordered `.table-shell`, a header band, a scrolling viewport, and a floating bulk-action pill. The card is itself the query container for its responsive behavior. Headers are 40px tall with 12px horizontal padding; rows are compact and zebra-striped at 5% brass. Long content truncates; the layout never wraps a row.

Spacing follows a 4px base with 8/12/16/24/32 as the working steps. Density is deliberate: the Table is tight, Showcases and note editing get 16–32px breathing room, and marketing-style whitespace is never used inside the Editor.

## Elevation & Depth

A hybrid, weighted toward tonal layering. Structure is carried by warm borders and stepped paper surfaces (Harbor Paper → Shell Cream → Sand Panel → Header Sand), and shadows only appear to signal interaction or floating chrome. Shadows are always warm brown-tinted rather than black, so elevation reads as lamp light, not as grey fog.

### Shadow Vocabulary
- **Ambient rest** (`0 1px 2px rgba(62, 44, 20, 0.07)`) — `--shadow-sm`: every button and control at rest.
- **Lifted** (`0 8px 24px rgba(62, 44, 20, 0.12)`) — `--shadow-md`: hovered controls, menus, the bulk pill, and the expanded sidebar.
- **Overlay** (`0 24px 48px rgba(62, 44, 20, 0.18)`) — `--shadow-lg`: dialogs, popovers, and the slideshow's floating controls.

### Named Rules
**The Flat-At-Rest Rule.** Cards are flat; only controls carry the ambient shadow. A larger shadow is earned by hover, openness, or floating above the page — never used as decoration.

## Shapes

Rounded and soft-edged, at four deliberate steps: 8px for small chips and inline controls, 10px for buttons, inputs, and cards, 16px for panels and edit-mode sections, and 20px for the largest surfaces and popovers. Pill radii are reserved for three things: the bulk-action bar, counters and version badges, and segmented controls. Borders are 1px in warm translucent brown (0.2 alpha for structure, 0.32 for controls, 0.12 for internal dividers). The brand mark uses a 9px rounded square with a brass gradient; category markers are circles. No clipping, notches, or angled corners appear anywhere in the system.

## Components

### Buttons
- **Shape:** 10px radius, 34px minimum height, 6px×12px padding, 0.84rem/600 label.
- **Default:** Shell Cream ground, 1px control border, Walnut Ink text, ambient shadow.
- **Primary:** Deep Brass ground and border, Shell Cream text; the only filled button.
- **Danger:** Signal Red ground with cream text; the soft variant uses a red wash, red text, and a 25%-alpha red border.
- **Hover / Focus:** border shifts to Harbor Brass and the shadow lifts to `--shadow-md`. Focus is a 2px Harbor Brass outline at 2px offset. Transitions are 0.15s on background, border, and shadow.

### Inputs / Fields
- **Style:** Shell Cream ground, 1px control border, 10px radius, 34px minimum height, 0.86rem text.
- **Focus:** border becomes Harbor Brass with the standard 2px accent outline; no glow.
- **Disabled / Error:** errors use Signal Red text and border; disabled controls keep their shape and drop to Faded Umber.
- **Search and filters:** the same field at 34px, with brass tint on the active-filter state rather than a heavier border.

### Table
- **Container:** a Shell Cream card with a 10px radius and 1px structural border, filling the viewport.
- **Header:** Header Sand band (`--surface-3`), 40px tall, 12px padding, 0.625rem/650 uppercase labels at 0.075em tracking in Umber; the sorted column alone switches to Deep Brass and reveals its chevron.
- **Body type:** 13.5px data cells in Walnut Ink. Catalog # and Denomination at 600; the serial as Code (13px/500, 0.045em tracking, Umber); the display order in Faded Umber because it is position rather than content; Grade as a 13px/600 pill tinted by band.
- **Rows:** zebra at 5% brass; hover at 12%; selected at 14% with a brass edge and a checked box carrying the state. Text truncates, never wraps.
- **Empty values:** a muted dash, the same in every cell that can be empty (display order, front image, grade, serial, tags), so one absence never reads as two different things across a row.
- **Empty view:** the message sits where the rows would be, as a named title, its recovery, and one hint line. A filter that matches nothing explains the OR/AND model and offers Clear filters; an empty collection offers Add the first note and Import / Export, and says where a new note lands.
- **Pinned cells:** the checkbox and thumbnail columns stay pinned; the checkbox focus halo is a 21px rounded square behind a clipped native control.
- **Horizontal pan:** the horizontal scrollbar is hidden, mirroring the Viewer, so off-screen columns are reached by dragging the table or pressing Left/Right. When the columns actually overflow, the footer says so with the same keycap pair (`←` `→` to pan) and drops the line when they fit.
- **Selection:** text selected inside the card takes a 24% brass wash instead of the platform blue, so copying a serial reads as marked paper.

### Chips & Tags
- **Style:** pill or 8px-rounded, brass wash ground, Deep Brass text, no heavy border.
- **State:** removable chips pair the label with an icon-only remove button; active filter chips match the selected-row tint.

### Sidebar Navigation
- **Style:** a 64px rail on Shell Cream with a 1px right border; category labels are 9.5px/800 uppercase with 0.14em tracking and a 20px circular brass marker.
- **Expansion:** width animates to `max(288px, max-content)` in 0.18s on a standard ease; the wordmark and link labels toggle display, so the marker never shifts.
- **States:** links are Umber at 12.5px/600, hover to a Sand Panel ground, and the active destination takes a brass-wash pill.

### Bulk Action Bar
- **Style:** a pill floating 16px above the bottom of the table, Deep Brass ground, cream text, `--shadow-md`. It overlays the rows instead of reserving space, so showing it never reflows the table.

### Load-Error Card
- **Style:** replaces the table in place at the table's height, inside the same card shell. A 700-weight title, a muted detail line, a reassurance line, and a single primary Try again button; only the copy block is a live region so the button is not announced twice.

### Loading Card
- **Style:** the same card shell at the same height while the notes are on their way, so a collection switch never collapses the screen and rebuilds it. A 650-weight "Loading notes…" title and one muted detail line, as a polite status; no spinner and no skeleton bars.

## Do's and Don'ts

### Do:
- **Do** keep every surface tinted with the paper ramp; Shell Cream is the ceiling of lightness.
- **Do** use Harbor Brass / Deep Brass alone for state and action, and keep it under roughly 10% of the screen.
- **Do** compact the Table (40px headers, 12px cell padding, truncation) and let Showcases be the looser surface.
- **Do** express hierarchy with weight, size, case, and tracking inside the one system sans.
- **Do** use the three warm shadows only for controls, raised chrome, and overlays.
- **Do** reach for pill radii on bars, counters, and segmented controls — and only those.
- **Do** write status feedback as a named title plus one detail line, with the recovery action adjacent.

### Don't:
- **Don't** introduce pure white, pure black, or any cold grey; they break the desk metaphor.
- **Don't** add a second accent hue, gradient text, or glassmorphism.
- **Don't** wrap table cells or soften row density to "breathe"; the Table is a scanning surface.
- **Don't** add a second typeface, an icon font, or decorative imagery.
- **Don't** place large decorative shadows on flat cards at rest.
- **Don't** turn the sidebar into a drawer or let it push the main column.
- **Don't** use red for anything but destruction and failure, or green for anything but success.
