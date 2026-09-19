# 12: Import screen parity

**What to build:** The dedicated Import screen replacing the inline manage panel: first-run conditional plus modal overlay entry from the table header, picker-to-confirm-to-blocking-import flow, Collection controls with verbatim confirms, four info pills with ported date format, outcome messages, and manifest version footer.

**Blocked by:** 08 (picker, blocking overlay, date-format port), 09 (header import button entry point).

**Status:** ready-for-agent

- [ ] Navigator-free: no dataset or no Collections renders the Import screen; otherwise table plus header import button toggling a full-screen modal; back blocked while mutating; import back button hidden on first-run and while busy
- [ ] Inline manage panel deleted; sole entry is the header import button from the Table screen ticket
- [ ] Picker with `.zip` filter; import action disabled until picked; verbatim Archive-replace confirm; short paint delay then controller import; blocking modal with spinner and archive name driven by the mutating flag; Windows manual-path fallback
- [ ] Collection controls ported verbatim: dropdown `Name (default?) (count)` with instant select clearing messages, `Set as default` disabled states, danger-tonal delete; four pills (Active source / Dataset built / Collections N / Notes(active) N) themed with sheet and pill styling
- [ ] Three destructive confirms plus success/error message panel copy verbatim (`Imported X successfully.` / `Import failed: ...` / `Deleted ...`); success clears picked path/name; footer version from the app manifest
- [ ] Interaction tests: first-run vs modal entry, disabled-until-picked, confirm copy, back-blocked-while-mutating, pill values, delete/default flows
