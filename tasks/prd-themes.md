# PRD: Theme & Appearance Customization

## Introduction

Ultra GitLab currently ships with a single hardcoded Kanagawa Wave dark theme and fixed fonts (Noto Sans JP + IBM Plex Mono). Not everyone on the team enjoys this colorway or font choice. This feature adds an appearance settings section where users can pick from preset themes, create simple custom colorways, and change the UI font — making the app feel personal and comfortable for every user.

## Goals

- Ship three built-in themes: **Kanagawa Wave** (dark), **Kanagawa Light**, and **Loved** (dark)
- Let users create simple custom themes by picking a few key colors (background, text, accent) and deriving the rest automatically
- Allow users to change the UI font family (the monospace/code font stays fixed)
- Ensure the Monaco editor and tree-sitter syntax highlighting adapt to the selected theme
- Persist theme choice per-user via the existing Settings infrastructure

## Reference: Current CSS Variable Surface

All app colors flow through ~30 CSS custom properties on `:root` in `src/App.css` (lines 32-118). The Monaco editor has a separate theme object in `src/components/Monaco/kanagawaTheme.ts`, and tree-sitter syntax colors live in `src/styles/syntax.css`. The font is imported via Google Fonts in `App.css` line 4.

The existing `Settings` type already has a `theme` field (`'light' | 'dark' | 'system'`) and a `setTheme()` storage function — neither is wired up yet.

## Theme Palettes

### Kanagawa Wave (existing — default)
Current colors already defined in `App.css`.

### Kanagawa Light (new)
A lighter companion: warm off-white backgrounds, dark text, same wave-blue accents. Derive from the official Kanagawa Lotus/Light palette conventions.

### Loved (new)
Based on [vscode-loved](https://github.com/paulvandermeijs/vscode-loved):
- Backgrounds: `#121926` (app), `#17202f` (editor/cards)
- Foreground: `#99a4b8` (secondary text), `#c0c5ce` (primary text)
- Accent/highlight: `#99beff`
- Status: orange `#f7987e`, green `#97a38f`, red `#e05252`, yellow `#eabe9a`
- Extras: purple `#b18bb1`, pink `#ea7599`, turquoise `#7ea9a9`, blue `#6e94b9`

### Custom Theme
Users pick **3 key colors** — background, text, accent — and the app derives the full variable set (hover states, borders, status colors, diff colors, etc.) using lightness/saturation shifts. Monaco syntax token colors are **not** derived — the custom theme reuses the token palette from the nearest preset based on background luminance (dark bg → Kanagawa Wave tokens, light bg → Kanagawa Light tokens).

## User Stories

### US-001: Extract theme variables into a theme system
**Description:** As a developer, I need the hardcoded CSS variables and Monaco/syntax themes factored out into a data-driven theme system so themes can be swapped at runtime.

**Acceptance Criteria:**
- [ ] Consolidate `--kw-*` variables (used 300+ times across 6 CSS files) into the main variable set: deduplicate aliases, promote unique colors (sakura pink, ronin yellow, surimi orange, etc.) as named semantic slots, remove the duplicate `:root` block in MRDetailPage.css
- [ ] Create a `src/themes/` directory with a `types.ts` defining a `ThemeDefinition` interface covering all CSS variables (including former `--kw-*` slots), Monaco token colors, and syntax highlight colors
- [ ] Create `kanagawa-wave.ts` exporting the current colors as a `ThemeDefinition`
- [ ] Remove hardcoded color values from `App.css` `:root` — variables remain but are now set dynamically
- [ ] Remove hardcoded colors from `src/styles/syntax.css` — replaced with CSS variables set by theme
- [ ] Create a `useTheme()` hook or theme provider that applies a `ThemeDefinition` to `:root` CSS variables on mount/change
- [ ] Monaco editor theme (`kanagawaTheme.ts`) is generated from the active `ThemeDefinition` rather than hardcoded
- [ ] App looks identical after this refactor (Kanagawa Wave still default)
- [ ] Typecheck passes (`bunx tsc --noEmit`)

### US-002: Add Kanagawa Light preset
**Description:** As a user who prefers light themes, I want a Kanagawa Light option so the app is comfortable in bright environments.

**Acceptance Criteria:**
- [ ] Create `src/themes/kanagawa-light.ts` with warm off-white backgrounds, dark text, and wave-blue accents
- [ ] Includes matching Monaco editor token colors for light background
- [ ] Includes matching syntax highlighting colors for light background
- [ ] All UI elements remain legible and have sufficient contrast (WCAG AA)
- [ ] Diff view add/remove colors are distinguishable on light background
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-003: Add Loved preset
**Description:** As a user, I want the "Loved" dark theme as an alternative to Kanagawa Wave.

**Acceptance Criteria:**
- [ ] Create `src/themes/loved.ts` using the Loved palette (backgrounds `#121926`/`#17202f`, accent `#99beff`, text `#c0c5ce`/`#99a4b8`, etc.)
- [ ] Includes matching Monaco editor token colors
- [ ] Includes matching syntax highlighting colors
- [ ] All status colors (error, success, warning) are distinguishable
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-004: Add Appearance section to Settings page
**Description:** As a user, I want an "Appearance" section in Settings where I can pick a theme and font.

**Acceptance Criteria:**
- [ ] New "Appearance" section in the existing Settings page, above or below existing sections
- [ ] Theme selector shows visual preview swatches/cards for each preset (Kanagawa Wave, Kanagawa Light, Loved, plus any custom themes)
- [ ] Currently active theme is visually highlighted
- [ ] Clicking a theme swatch applies it immediately (live preview, no save button needed)
- [ ] Font selector dropdown listing available UI fonts (see US-006)
- [ ] Selected theme and font persist across app restarts via the Settings store
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-005: Custom colorway creation
**Description:** As a user, I want to create my own color scheme by picking a few key colors so I can match my personal taste or company brand.

**Acceptance Criteria:**
- [ ] "Create Custom Theme" option in the Appearance section
- [ ] User picks 3 colors: **background**, **text**, and **accent**
- [ ] App derives the full variable set automatically (secondary/tertiary backgrounds via lightness shifts, hover states, border colors, status colors with appropriate hue, diff colors, etc.)
- [ ] Live preview updates as user picks colors
- [ ] Custom theme is saved and appears alongside presets in the theme selector
- [ ] User can edit or delete their custom theme
- [ ] Only one custom theme needs to be supported (stretch: multiple)
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-006: Font selection
**Description:** As a user, I want to choose the UI font so the app matches my reading preferences.

**Acceptance Criteria:**
- [ ] Dropdown or list in Appearance section with font options
- [ ] Ships with at least: Noto Sans JP (current default), Inter, SF Pro (system), System Default
- [ ] Selecting a font applies it immediately to all UI text (not monospace/code areas)
- [ ] Monospace font (IBM Plex Mono) remains unchanged for code/technical elements
- [ ] Font choice persists across restarts
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-007: Adapt Monaco editor to active theme
**Description:** As a user, I want the code editor to match my selected theme so there's no jarring color mismatch.

**Acceptance Criteria:**
- [ ] When theme changes, Monaco editor re-registers and applies a matching theme
- [ ] Editor background, foreground, selection, line highlight, and gutter colors all derive from the active `ThemeDefinition`
- [ ] Syntax token colors (keywords, strings, comments, etc.) are part of the `ThemeDefinition` and applied to Monaco
- [ ] No flash or flicker when switching themes
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-008: Adapt tree-sitter syntax highlighting to active theme
**Description:** As a user, I want inline syntax-highlighted code outside Monaco to also match my theme.

**Acceptance Criteria:**
- [ ] Tree-sitter syntax colors in `src/styles/syntax.css` converted to CSS variables
- [ ] `ThemeDefinition` includes syntax token colors that map to these variables
- [ ] Theme switch updates syntax highlighting everywhere (diff views, inline code)
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

## Functional Requirements

- **FR-1:** The app must support a `ThemeDefinition` data structure containing: all CSS variable values, Monaco editor theme colors, and syntax highlighting token colors.
- **FR-2:** Themes are applied by setting CSS custom properties on `:root` at runtime. No CSS file swapping.
- **FR-3:** The app must ship with three presets: Kanagawa Wave (default), Kanagawa Light, Loved.
- **FR-4:** Users can create one custom theme by selecting background, text, and accent colors. The full palette is auto-derived.
- **FR-5:** The derived palette algorithm must produce: 3 background shades, 4 text shades, hover/selected states, border colors, accent variants, status colors (error/success/warning/info), diff colors, and input/card/code backgrounds. Monaco syntax token colors are reused from the nearest preset by background luminance (dark → Kanagawa Wave, light → Kanagawa Light).
- **FR-6:** Users can select a UI font from a curated list. The monospace font is not configurable.
- **FR-7:** Theme and font selection persist in the app's Settings store and restore on launch.
- **FR-8:** Monaco editor must re-theme when the app theme changes, with no visible flash.
- **FR-9:** Tree-sitter syntax highlighting must use CSS variables that update with the theme.
- **FR-10:** The Settings `Theme` type must be updated from `'light' | 'dark' | 'system'` to support named theme IDs (e.g., `'kanagawa-wave' | 'kanagawa-light' | 'loved' | 'custom'`).

## Non-Goals

- No dark/light auto-switching based on OS preference (can be added later)
- No import/export of theme files between users
- No per-page or per-panel theme overrides
- No monospace/code font customization
- No font-size customization
- No multiple custom themes (one is enough for v1)
- No theme marketplace or remote theme loading

## Design Considerations

- Theme swatches in the selector should show a small preview: background color, text sample, accent dot — enough to distinguish at a glance
- The custom color picker should use a compact inline picker (e.g., native `<input type="color">` or a small popover), not a full-screen modal
- Font preview: each font option should render its own name in that font for instant comparison
- Keep the Appearance section compact — it's part of the existing Settings page, not a standalone experience

## Technical Considerations

- **CSS variables on `:root`** are already the pattern — this is a refactor-in-place, not a new architecture
- **Monaco theming API**: use `monaco.editor.defineTheme()` + `monaco.editor.setTheme()` — must be called before or after editor mount; consider a React effect that re-defines on theme change
- **Google Fonts**: Lazy-load strategy — on startup, load only the user's saved font choice. When the Appearance section opens, background-load the remaining fonts so previews render correctly. Avoids unnecessary bandwidth on startup while keeping the settings experience smooth
- **Color derivation**: use HSL manipulation to derive the full palette from 3 input colors. A small utility function — no external library needed
- **Existing `setTheme()` in `src/services/storage.ts`** and `theme` field in `Settings` type can be reused, but the type needs updating from `'light'|'dark'|'system'` to theme IDs
- **`--kw-*` variable consolidation**: The `--kw-*` variables in `MRDetailPage.css` (used 300+ times across 6 CSS files) must be merged into the main variable set as part of US-001. Most are duplicates of existing main variables (e.g., `--kw-bg-default` = `--bg-primary`). Unique ones (sakura pink, ronin yellow, surimi orange, etc.) become named semantic slots in `ThemeDefinition` (e.g., `--accent-pink`, `--accent-orange`). The duplicate `:root` block in MRDetailPage.css is removed entirely
- **Performance**: applying ~30 CSS variables to `:root` is near-instant; no performance concern

## Success Metrics

- Users can switch between all three presets in under 2 clicks from Settings
- Custom theme creation takes under 30 seconds (pick 3 colors, done)
- Zero visual regressions — all UI elements remain legible and properly styled in every preset
- Monaco editor and syntax highlighting visually match the selected theme

## Resolved Decisions

- **Custom theme syntax tokens:** Reuse the nearest preset's Monaco/syntax token palette based on background luminance (dark bg → Kanagawa Wave tokens, light bg → Kanagawa Light tokens). Deriving 10+ distinguishable token colors from just 3 inputs is unreliable.
- **Font loading strategy:** Lazy-load. On startup, load only the user's saved font. When the Appearance section opens, background-load the remaining fonts for preview rendering. Keeps startup fast, settings experience smooth.
- **`--kw-*` variable consolidation:** Merge into the main variable set. Deduplicate aliases (e.g., `--kw-bg-default` → `--bg-primary`), promote unique colors as semantic slots in `ThemeDefinition`, remove the duplicate `:root` block in MRDetailPage.css. Mechanical find-and-replace across 6 files.
