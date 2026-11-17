import { MenuIcon } from "./MenuIcon.jsx";
import { SelectField } from "./SelectField.jsx";

// The name field shared by the showcase's create and rename dialogs. It is the
// app's one select in free-text mode: the same box and chevron, the pool ranked
// as options, and an option list that never traps a typed name. An unplaced
// pool label also carries a delete action, so the pool can be pruned from the
// same list that offers it.
function showcaseUsage(suggestion) {
  return `${suggestion.showcase_count} ${
    suggestion.showcase_count === 1 ? "showcase" : "showcases"
  }`;
}

function suggestionLabel(suggestion) {
  return suggestion.showcase_count > 0
    ? `${suggestion.name}, placed in ${showcaseUsage(suggestion)}`
    : suggestion.name;
}

function ShowcaseNameField({
  deletingSuggestionId = null,
  label,
  onChange,
  onDelete,
  suggestions = [],
  suggestionsLabel = "Name suggestions",
  value,
}) {
  const options = suggestions.map((suggestion) => ({
    ariaLabel: suggestionLabel(suggestion),
    label: suggestion.name,
    suggestion,
    value: suggestion.name,
  }));

  function canDelete(suggestion) {
    // Older payloads may omit the count; treat an unknown count as unused so
    // the action stays reachable, and let the server reject a used label.
    return Boolean(onDelete) && (suggestion?.showcase_count ?? 0) === 0;
  }

  function deleteSuggestion(option) {
    if (
      !canDelete(option.suggestion) ||
      (deletingSuggestionId != null && deletingSuggestionId === option.suggestion.id)
    ) {
      return;
    }

    onDelete(option.suggestion);
  }

  function renderOptionAction(option) {
    const suggestion = option.suggestion;

    if (canDelete(suggestion)) {
      return (
        <button
          aria-keyshortcuts="Delete"
          aria-label={`Delete ${suggestion.name} from the category pool`}
          className="showcase-name-suggestion-delete"
          disabled={deletingSuggestionId != null}
          onClick={(event) => {
            event.stopPropagation();
            deleteSuggestion(option);
          }}
          onMouseDown={(event) => event.preventDefault()}
          title="Delete from the category pool"
          type="button"
        >
          <MenuIcon
            className="showcase-name-suggestion-delete-icon"
            name="delete"
          />
        </button>
      );
    }

    if (suggestion.showcase_count > 0) {
      return (
        <span className="tags-filter-option-count">
          {showcaseUsage(suggestion)}
        </span>
      );
    }

    return null;
  }

  return (
    <div className="field-block">
      <span>{label}</span>
      <SelectField
        ariaLabel={label}
        autoFocus
        freeText
        listboxLabel={suggestionsLabel}
        onChange={onChange}
        onDeleteOption={onDelete ? deleteSuggestion : undefined}
        options={options}
        renderOptionAction={onDelete ? renderOptionAction : undefined}
        value={value}
      />
    </div>
  );
}

export { ShowcaseNameField };
