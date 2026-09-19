Type: research
Status: resolved

## Question

Where exactly do RN search and Flutter search diverge? Audit `filterViewerNotes` in `apps/viewer/react-native/src/shared/viewer-core/search.ts` against Flutter's `notes_table_screen.dart` search: field prefixes (`denom:`/`denomination:` vs `denom:/denomination:`, `date:`, `cat:/catalog:`, `company:/grading:`, `grade:`, `tag(s):` vs `tags:/tag:`), `,` multi-value, `!` negation, thousands/date awareness, denomination normalization (`10,000=10.000=10 000=10000`), plain-text fallback. Output the prefix-by-prefix diff table + which side is canonical for parity.

## Answer

No divergence found — RN `search.ts` and Flutter `notes_table_screen.dart` search are logic-identical across every row:

| Prefix / behavior | Result |
|---|---|
| `denomination:`/`denom:`, `date:`, `catalog:`/`cat:`, `company:`/`grading:`, `grade:`, `tag:`/`tags:` | Identical aliases, targets, and match semantics (catalog prefix+boundary, grade/company substring, tags exact-set AND) |
| Multi-value `,`, `!` negation, thousands/date comma guards | Identical (`splitFilterValues`, `parseFilterToken`, `isThousandsSeparator`, `isMonthDayYearDateComma`) |
| Denomination normalization (`10,000=10.000=10 000=10000`, amount-plus-residual-text rule) | Identical (`normalizedDenominationAmount`) |
| Plain-text fallback (lowercased `allFields`, 9-field haystack, AND terms) | Identical |

Canonical calls: **RN canonical everywhere** — only RN is a tested shared core (`viewer-core/index.test.ts` covers `tags:`/`catalog:`/`denom:`, negation, multi-value, date-comma, thousands); Flutter's are private inline copies with no dedicated test. Parity = Flutter tracks RN, not the reverse.

Non-search note (out of ticket scope, for the table ticket): sort differs — RN `localeCompare(numeric:true)` vs Flutter plain `compareTo` — RN sort is the candidate canonical.

## Comments
