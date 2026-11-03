---
name: Note Harbor Editor
description: Red, ink, and white collection software for banknote archives
colors:
  brand-red: "#e60000"
  brand-red-deep: "#b80000"
  ink: "#25282b"
  rail: "#2c3a45"
  body: "#5f6367"
  body-faint: "#6e7276"
  canvas: "#ffffff"
  canvas-soft: "#f2f2f2"
  canvas-mist: "#f7f7f7"
  canvas-step: "#e6e6e6"
  on-dark: "#ffffff"
  danger: "#a30000"
  success: "#157a3a"
  warning: "#7a4f00"
  info: "#29597a"
typography:
  display:
    fontFamily: "Inter, Helvetica Neue, Helvetica, Arial, Noto Sans, sans-serif"
    fontSize: "1.3125rem"
    fontWeight: 800
    lineHeight: 1.5
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Inter, Helvetica Neue, Helvetica, Arial, Noto Sans, sans-serif"
    fontSize: "1.4rem"
    fontWeight: 800
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Inter, Helvetica Neue, Helvetica, Arial, Noto Sans, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  data:
    fontFamily: "Inter, Helvetica Neue, Helvetica, Arial, Noto Sans, sans-serif"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.5
  code:
    fontFamily: "Inter, Helvetica Neue, Helvetica, Arial, Noto Sans, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    letterSpacing: "0.045em"
  meta:
    fontFamily: "Inter, Helvetica Neue, Helvetica, Arial, Noto Sans, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter, Helvetica Neue, Helvetica, Arial, Noto Sans, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 700
    letterSpacing: "0.08em"
  wordmark:
    fontFamily: "Inter, Helvetica Neue, Helvetica, Arial, Noto Sans, sans-serif"
    fontSize: "13.5px"
    fontWeight: 800
    letterSpacing: "-0.01em"
rounded:
  sm: "8px"
  md: "6px"
  control: "10px"
  card: "6px"
  pill: "100px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  section: "32px"
components:
  button-default:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    borderColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "6px 18px"
    height: "36px"
  button-primary:
    backgroundColor: "{colors.brand-red}"
    textColor: "{colors.on-dark}"
    borderColor: "{colors.brand-red}"
    rounded: "{rounded.pill}"
    padding: "6px 18px"
    height: "36px"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.on-dark}"
    rounded: "{rounded.pill}"
    padding: "6px 18px"
    height: "36px"
  filter-input:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    borderColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "6px 10px"
    height: "34px"
  table-shell:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    borderColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "0"
  nav-bar:
    backgroundColor: "{colors.rail}"
    textColor: "{colors.on-dark}"
    borderColor: "{colors.rail}"
    rounded: "0"
    padding: "0 12px"
  badge-chip:
    backgroundColor: "{colors.canvas-soft}"
    textColor: "{colors.brand-red-deep}"
    rounded: "7px"
    padding: "2px 8px"
---

# Design System: Note Harbor Editor

## Overview

**Creative North Star: "The Campaign Poster, Set to Work."**

The Editor takes a poster-scale brand language — red, near-black ink, white content bands, uppercase weight-800 display type, and pill controls — and turns it into a dense working surface for cataloguing banknotes. It is not a marketing page, so the poster voice appears where the app speaks to the user (screen titles, eyebrows, primary actions) and then gives way to white data bands, hairline grids, and quiet grey chrome.

Three materials carry the whole system: **slate ink** (#2c3a45) as the navigation rail, **ink** (#25282b) as the overlay world, **white** (#ffffff) as the content and table surface, and **brand red** (#e60000) as the single accent. Red never becomes a background wash on the page; it marks the primary action, the active navigation edge, selection, focus, and the tags that need attention. Everything else is a neutral step on the white-to-grey ladder.

Structure stays dense and quiet. The Table screen is the centre of gravity: one bordered white card filling the viewport, a fixed 64px slate rail that expands on hover, compact 40px headers, and 12px cell padding tuned for scanning hundreds of rows. Capture, Import, and Showcase screens reuse the same card, field, and pill vocabulary at a lower density.

**Key Characteristics:**
- One accent: `{colors.brand-red}` (#e60000). Filled pills for the primary action, outline pills for secondary actions, red text for links and active state.
- Settled chrome, loud content: the slate rail holds the same dark band the layout is built around, a step off pure ink so overlays stay the darkest surface. White bands and the red accent carry all the contrast. No warm greys, no pure black, no second accent hue.
- Uppercase weight-800 display type with tight tracking for screen titles and eyebrows; sentence case for the calm secondary voice.
- Pill geometry on every button and counter (100px), a 10px step on fields and selects, and a 7px rounded rectangle on filter chips and tags. Cards stay flat at 6px.
- Flat at rest: cards carry no shadow; only floating chrome (menus, dialogs, the expanded rail) lifts.

## Colors

### Brand & Accent
- **Brand Red** (`{colors.brand-red}` — `#e60000`): The single accent. Primary button fill, active sidebar edge, focus ring, selected-row edge, tag chips, and the bulk-action bar. It clears 4.5:1 against white, so white button labels stay legible.
- **Deep Red** (`{colors.brand-red-deep}` — `#b80000`): Red type on white — links, active filter values, sort labels, tag text, and the primary button's hover fill.

### Surface
- **Canvas** (`{colors.canvas}` — `#ffffff`): Cards, inputs, menus, and the table surface.
- **Canvas Soft** (`{colors.canvas-soft}` — `#f2f2f2`): The application ground, table header band, and quiet panels.
- **Canvas Mist** (`{colors.canvas-mist}` — `#f7f7f7`): The filter rail and secondary panel fills.
- **Canvas Step** (`{colors.canvas-step}` — `#e6e6e6`): The deepest neutral step, used for the drag handle's hover.
- **Rail Slate** (`{colors.rail}` — `#2c3a45`): The navigation rail, and only the rail. A cool slate, not warm; it stays dark for contrast but reads as structure rather than a void.
- **Ink** (`{colors.ink}` — `#25282b`): The overlay world and double-height bands. Doubles as the primary text colour.

### Text
- **Ink** (`{colors.ink}` — `#25282b`): Headings, table cells, field values.
- **Body** (`{colors.body}` — `#5f6367`): Secondary copy, labels, captions; clears 4.5:1 on every surface it sits on.
- **Body Faint** (`{colors.body-faint}` — `#6e7276`): Tertiary metadata — row numbers, empty dashes, captions.
- **On Dark** (`{colors.on-dark}` — `#ffffff`): Navigation labels, overlay content, and text on red.

### Semantic
The brand has no separate semantic palette, but the Editor needs status. These three muted hues are the only exceptions to the red/ink/neutral rule, and each appears only inside a status chip or inline message:
- **Danger** (`{colors.danger}` — `#a30000`) on `rgba(163, 0, 0, 0.08)`: destructive actions and load errors.
- **Success** (`{colors.success}` — `#157a3a`) on `rgba(49, 162, 76, 0.12)`: saved / scraped states.
- **Warning** (`{colors.warning}` — `#7a4f00`) on `rgba(247, 185, 40, 0.16)`: warnings and scrape conflicts.
- **Info** (`{colors.info}` — `#29597a`) on `rgba(41, 89, 122, 0.12)`: informational callouts.

### Named Rules
**The One Red Rule.** Red is state and action, never decoration. It covers at most about a tenth of any screen; its rarity is what makes the primary pill and the active edge read instantly.

**The White Room Rule.** Content lives on white or on a grey step of the same neutral family. No warm cream, blue-grey, or second tinted neutral enters the page.

## Typography

**Display Font:** none — the system uses no display face.
**Body Font:** `Inter`, bundled as a local variable font at
`public/fonts/InterVariable.ttf`, with `Helvetica Neue, Helvetica, Arial,
"Noto Sans"` as the fallback chain. The same stack is used for data and labels.
**Label/Mono Font:** the same stack, with `font-variant-numeric: tabular-nums` wherever numbers change in place.

**Character:** A single sans worked hard. Inter is a close stand-in for the brand's display face and ships with the app, so the type never depends on what the host OS installs. Hierarchy is built from weight, size, case, and tracking, never from a second family.

### Hierarchy
- **Display** (800, 1.3125rem/1.5, `-0.01em`, uppercase): the collection / page title in the Table screen. The brand's billboard voice at the smallest size that still fits a dense header.
- **Title** (800, 1.4rem/1.3, uppercase): Showcase Category titles and screen headings. Every top-level `h1` in a panel or screen body takes this voice.
- **Panel heading** (700, ~1.05–1.15rem): card and panel headings that introduce a block rather than a screen.
- **Body** (400, 0.86–0.9rem/1.5): field values and running copy.
- **Data** (400, 13.5px): table cell values in a 45px row. Weight, not size, separates roles — Catalog # and Denomination at 600, the rest at 400.
- **Code** (500, 13px, 0.045em tracking): serial numbers, one step under Data.
- **Control** (600, 0.84rem/1.2): buttons, links, and tabs.
- **Label** (700, 0.6875rem, 0.08em, uppercase): table and menu headers, in Body, so 11px caps clear 4.5:1 on the header band.
- **Meta** (400, 0.75rem/1.5, tabular): the table's summary and status lines.

### Named Rules
**The Shout Then Speak Rule.** Screen titles and eyebrows shout — uppercase, weight 800, tight tracking. Supporting headings and running copy speak in sentence case. Never set body copy in the display voice.

**The Tabular Rule.** Any number that changes in place — counters, positions, sizes — is set in `tabular-nums` so it never jitters.

## Layout

A fixed, non-scrolling app shell: a slate ink left rail plus a main column that fills the remaining width and height. The dock is a 64px rail whose contents expand over the content to a max of 480px on hover or keyboard focus; it never becomes a drawer and never pushes the main column. Main padding is 16px vertical and 24px horizontal; screens stack with 24px gaps.

The Table screen is one card that consumes the whole remaining area: a bordered `.table-shell`, a grey header band, a scrolling viewport, and a floating bulk-action pill. The card is its own query container. Headers are 40px tall with 12px horizontal padding; rows are 45px with 12px cell padding and a faint neutral zebra stripe. Long content truncates; the layout never wraps a row.

Spacing follows a 4px base with 8/12/16/24/32 as the working steps. Density is deliberate: the Table is tight, Showcases and note editing get 16–32px breathing room, and marketing-style whitespace is never used inside the Editor.

## Elevation & Depth

Tonal layering, not shadow. Structure is carried by ink/white polarity and the white → `#f7f7f7` → `#f2f2f2` → `#e6e6e6` neutral steps. Cards are flat at rest. Shadows exist only for chrome that floats above the page.

### Shadow Vocabulary
- **Ambient rest:** none. Cards, panels, and controls are flat.
- **Lifted** (`0 12px 32px rgba(37, 40, 43, 0.16)`): menus, dropdowns, the expanded rail, and the bulk pill.
- **Overlay** (`0 24px 64px rgba(37, 40, 43, 0.22)`): dialogs, the note editor panel, the slideshow panel, and other modals.

### Named Rules
**The Flat-At-Rest Rule.** A flat card is the default. A shadow is earned by openness or floating above the page — never used as decoration.

## Shapes

Four deliberate steps: 8px for tight inline controls (`--radius-sm`), 10px for fields and selects (`--radius-control`), 6px for cards, menus, and panels (`--radius-md`, `--radius-lg`, `--radius-xl` all resolve to the brand's 6px), and a true pill (100px) for buttons, counters, segmented controls, and the bulk-action bar. Tag and filter chips stay at the 7px rounded rectangle. Borders are 1px in translucent ink (0.1 alpha for internal dividers, 0.18 for structure, 0.32 for controls). The brand mark is a 6px red square; category markers are 20px circles. No clipping, notches, or angled corners appear anywhere in the system.

## Components

### Buttons
- **Shape:** pill (`100px`), 36px minimum height, 6px×18px padding, 0.84rem/600 label. No drop shadow at rest.
- **Default:** white ground, 1px control border, ink text. Hover tints the ground with the red wash and turns the border red.
- **Primary:** Brand Red ground and border with white text; the only filled button at rest. Hover deepens to `#b80000`.
- **Danger:** deep red fill with white text; the soft variant uses a red wash, red text, and a red hairline.
- **Focus:** a 2px red outline at 2px offset. Transitions are 0.15s on background, border, and colour.

### Inputs / Fields
- **Style:** white ground, 1px control border, 10px radius, 34px minimum height, 0.86rem text.
- **Focus:** border becomes red with the standard 2px red hairline halo; no glow.
- **Disabled / Error:** errors use the danger text and border; disabled controls keep their shape and drop to Body Faint.
- **Search and filters:** the same field at 34–36px; the active-filter state adds a red border rather than a fill.

### Table
- **Container:** a white card with a 6px radius, 1px structural border, filling the viewport.
- **Header:** Canvas Soft band, 40px tall, 12px padding, 0.6875rem/800 uppercase labels at 0.075em tracking in Body; the sorted column alone switches to Deep Red and reveals its chevron.
- **Body type:** 13.5px data cells in Ink. Catalog # and Denomination at 600; the serial as Code (13px/500, 0.045em tracking, Body); the display order in Body Faint. Grade is a 13px/600 pill tinted by band (success green, warning amber, neutral).
- **Rows:** neutral zebra at 3.5% ink; hover at 7% red; selected at 9% red with a red edge and a checked box carrying the state. Text truncates, never wraps.
- **Empty values:** a muted dash in every cell that can be empty, so one absence never reads as two different things across a row.
- **Empty view:** the message sits where the rows would be, as a named title, its recovery, and one hint line.
- **Pinned cells:** the checkbox and thumbnail columns stay pinned; the checkbox focus halo is a 21px red-tinted rounded square behind a clipped native control.
- **Horizontal pan:** the horizontal scrollbar is hidden; when columns overflow, the footer names the `←` `→` pan pair.
- **Selection:** text selected inside the card takes a 14% red wash instead of the platform blue.

### Chips & Tags
- **Style:** 7px rounded rectangle, red wash ground, Deep Red text, 1px red-tinted hairline.
- **State:** removable chips pair the label with an icon-only remove button; active filter chips match the selected-row tint; the "more" chip is a dashed muted ghost.

### Sidebar Navigation
- **Style:** a 64px Rail Slate rail with white text and a 1px hairline right border; category labels are 9.5px/800 uppercase with 0.14em tracking at 72% white, and a 20px marker ringed in an 18% white hairline.
- **Expansion:** width animates to `max(288px, max-content)` in 0.18s; the wordmark and link labels toggle display, so the marker never shifts. The expanded rail lifts with the ambient floating shadow.
- **States:** links sit at 72% white, hover to an 8% white wash, and the active destination takes a 13% white pill plus a 3px red left-edge bar in white text. The `+ New` actions are light red (#ff8a84).
- **Brand mark:** the red square with the banknote glyph is the rail's only solid red element.

### Bulk Action Bar
- **Style:** a pill floating 16px above the bottom of the table, Brand Red ground, white text, floating shadow. It overlays the rows instead of reserving space, so showing it never reflows the table.

### Load-Error / Loading Cards
- **Style:** replace the table in place at the table's height, inside the same card shell. A 700-weight title, a muted detail line, a reassurance line, and one primary Try again pill; only the copy block is a live region so the button is not announced twice.
- **Loading:** the same shell at the same height, a 650-weight "Loading notes…" title, and one muted detail line as a polite status; no spinner and no skeleton bars.

### Overlays
- **Scrim:** ink at 50–88% opacity. The slideshow and image popover keep the deep ink surfaces with white text; the note editor uses a light grey scrim with a white panel.
- **Panel:** 6px radius, 1px ink hairline, floating shadow. Slideshow tags use a red wash on dark with white text.

## Do's and Don'ts

### Do:
- **Do** reserve Brand Red for the primary pill, the active navigation edge, focus, selection, and the tag family.
- **Do** set screen titles and eyebrows in uppercase weight 800 with tight tracking; that stencil contrast is the brand voice.
- **Do** use pills for buttons and counters, 10px corners for fields and selects, 7px for chips, and 6px for cards and panels.
- **Do** cycle the page: slate rail → white content → ink only for overlays. Polarity is the depth cue.
- **Do** keep the Table compact (40px headers, 45px rows, 12px cell padding, truncation) and let Showcases be the looser surface.
- **Do** write status feedback as a named title plus one detail line, with the recovery action adjacent.

### Don't:
- **Don't** introduce a second accent hue, a gradient, or glassmorphism.
- **Don't** paint large red fills behind content; red is a marker, not a ground.
- **Don't** use soft drop shadows on flat cards at rest.
- **Don't** wrap table cells or soften row density to "breathe"; the Table is a scanning surface.
- **Don't** set body copy in uppercase or weight 800; the display voice is for titles only.
- **Don't** turn the sidebar into a drawer or let it push the main column.
- **Don't** square off a button or a chip: buttons are pills and chips keep their 7px rectangle.
