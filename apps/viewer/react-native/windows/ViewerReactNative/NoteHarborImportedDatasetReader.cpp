#include "pch.h"

#include "NoteHarborImportedDatasetReader.h"

#include <winsqlite/winsqlite3.h>

#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <cstring>
#include <optional>
#include <sstream>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

using namespace winrt::Microsoft::ReactNative;

namespace {

constexpr auto kImageApiPrefix = "/api/images/";

struct Statement final {
  explicit Statement(sqlite3_stmt *value = nullptr) noexcept : value(value) {}
  ~Statement() noexcept {
    if (value != nullptr) {
      sqlite3_finalize(value);
    }
  }

  Statement(const Statement &) = delete;
  Statement &operator=(const Statement &) = delete;

  Statement(Statement &&other) noexcept : value(other.value) {
    other.value = nullptr;
  }

  Statement &operator=(Statement &&other) noexcept {
    if (this != &other) {
      if (value != nullptr) {
        sqlite3_finalize(value);
      }

      value = other.value;
      other.value = nullptr;
    }

    return *this;
  }

  sqlite3_stmt *value{nullptr};
};

struct DatabaseHandle final {
  explicit DatabaseHandle(sqlite3 *value = nullptr) noexcept : value(value) {}
  ~DatabaseHandle() noexcept {
    if (value != nullptr) {
      sqlite3_close(value);
    }
  }

  DatabaseHandle(const DatabaseHandle &) = delete;
  DatabaseHandle &operator=(const DatabaseHandle &) = delete;

  sqlite3 *value{nullptr};
};

struct CollectionRecord {
  int id{0};
  std::string name;
  bool isDefault{false};
};

std::string StringValue(const JSValueObject &object, const char *key) {
  auto iterator = object.find(key);
  if (iterator == object.end() || iterator->second.IsNull()) {
    return {};
  }

  return iterator->second.AsString();
}

std::string Trim(std::string value) {
  auto isWhitespace = [](unsigned char character) {
    return std::isspace(character) != 0;
  };

  value.erase(value.begin(), std::find_if(value.begin(), value.end(), [&](unsigned char character) {
    return !isWhitespace(character);
  }));
  value.erase(std::find_if(value.rbegin(), value.rend(), [&](unsigned char character) {
    return !isWhitespace(character);
  }).base(), value.end());
  return value;
}

std::string ColumnText(sqlite3_stmt *statement, int index) {
  const auto *text = sqlite3_column_text(statement, index);
  return text != nullptr ? std::string(reinterpret_cast<const char *>(text)) : std::string{};
}

std::optional<Statement> Prepare(sqlite3 *database, const char *sql) {
  sqlite3_stmt *statement = nullptr;
  if (sqlite3_prepare_v2(database, sql, -1, &statement, nullptr) != SQLITE_OK) {
    return std::nullopt;
  }

  return Statement{statement};
}

bool TableExists(sqlite3 *database, const char *tableName) {
  auto statement = Prepare(database, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1");
  if (!statement.has_value()) {
    return false;
  }

  sqlite3_bind_text(statement->value, 1, tableName, -1, SQLITE_TRANSIENT);
  return sqlite3_step(statement->value) == SQLITE_ROW;
}

bool ColumnExists(sqlite3 *database, const char *tableName, const char *columnName) {
  const auto query = std::string{"PRAGMA table_info("} + tableName + ")";
  auto statement = Prepare(database, query.c_str());
  if (!statement.has_value()) {
    return false;
  }

  const auto target = Trim(std::string{columnName});
  while (sqlite3_step(statement->value) == SQLITE_ROW) {
    if (Trim(ColumnText(statement->value, 1)) == target) {
      return true;
    }
  }

  return false;
}

std::string JoinImagePath(const std::string &rootPath, const std::string &relativePath) {
  std::string result = rootPath;
  if (!result.empty() && result.back() != '\\' && result.back() != '/') {
    result += '/';
  }

  result += relativePath;
  std::replace(result.begin(), result.end(), '\\', '/');
  return result;
}

std::string UnescapeJsonString(const std::string &value) {
  std::string result;
  result.reserve(value.size());

  for (size_t index = 0; index < value.size(); ++index) {
    const char current = value[index];
    if (current == '\\' && index + 1 < value.size()) {
      const char escaped = value[++index];
      switch (escaped) {
        case '"':
        case '\\':
        case '/':
          result.push_back(escaped);
          break;
        case 'b':
          result.push_back('\b');
          break;
        case 'f':
          result.push_back('\f');
          break;
        case 'n':
          result.push_back('\n');
          break;
        case 'r':
          result.push_back('\r');
          break;
        case 't':
          result.push_back('\t');
          break;
        default:
          result.push_back(escaped);
          break;
      }
      continue;
    }

    result.push_back(current);
  }

  return result;
}

std::optional<std::string> ExtractJsonStringField(const std::string &objectText, const std::string &fieldName) {
  const auto fieldToken = std::string{"\""} + fieldName + "\"";
  const auto fieldPosition = objectText.find(fieldToken);
  if (fieldPosition == std::string::npos) {
    return std::nullopt;
  }

  auto colonPosition = objectText.find(':', fieldPosition + fieldToken.size());
  if (colonPosition == std::string::npos) {
    return std::nullopt;
  }

  colonPosition += 1;
  while (colonPosition < objectText.size() && std::isspace(static_cast<unsigned char>(objectText[colonPosition])) != 0) {
    colonPosition += 1;
  }

  if (colonPosition >= objectText.size() || objectText[colonPosition] != '"') {
    return std::nullopt;
  }

  std::string value;
  bool escaped = false;
  for (size_t index = colonPosition + 1; index < objectText.size(); ++index) {
    const char current = objectText[index];
    if (escaped) {
      value.push_back('\\');
      value.push_back(current);
      escaped = false;
      continue;
    }

    if (current == '\\') {
      escaped = true;
      continue;
    }

    if (current == '"') {
      return UnescapeJsonString(value);
    }

    value.push_back(current);
  }

  return std::nullopt;
}

std::vector<std::string> SplitJsonObjects(const std::string &jsonArrayText) {
  std::vector<std::string> objects;
  int depth = 0;
  bool inString = false;
  bool escaped = false;
  size_t objectStart = std::string::npos;

  for (size_t index = 0; index < jsonArrayText.size(); ++index) {
    const char current = jsonArrayText[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (current == '\\') {
      escaped = true;
      continue;
    }

    if (current == '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (current == '{') {
      if (depth == 0) {
        objectStart = index;
      }
      depth += 1;
      continue;
    }

    if (current == '}') {
      depth -= 1;
      if (depth == 0 && objectStart != std::string::npos) {
        objects.push_back(jsonArrayText.substr(objectStart, index - objectStart + 1));
        objectStart = std::string::npos;
      }
    }
  }

  return objects;
}

void SkipJsonWhitespace(const std::string &jsonText, size_t &index) {
  while (index < jsonText.size() && std::isspace(static_cast<unsigned char>(jsonText[index])) != 0) {
    index += 1;
  }
}

void AppendUtf8CodePoint(std::string &result, uint32_t codePoint) {
  if (codePoint <= 0x7F) {
    result.push_back(static_cast<char>(codePoint));
    return;
  }

  if (codePoint <= 0x7FF) {
    result.push_back(static_cast<char>(0xC0 | (codePoint >> 6)));
    result.push_back(static_cast<char>(0x80 | (codePoint & 0x3F)));
    return;
  }

  if (codePoint <= 0xFFFF) {
    result.push_back(static_cast<char>(0xE0 | (codePoint >> 12)));
    result.push_back(static_cast<char>(0x80 | ((codePoint >> 6) & 0x3F)));
    result.push_back(static_cast<char>(0x80 | (codePoint & 0x3F)));
    return;
  }

  result.push_back(static_cast<char>(0xF0 | (codePoint >> 18)));
  result.push_back(static_cast<char>(0x80 | ((codePoint >> 12) & 0x3F)));
  result.push_back(static_cast<char>(0x80 | ((codePoint >> 6) & 0x3F)));
  result.push_back(static_cast<char>(0x80 | (codePoint & 0x3F)));
}

std::optional<uint32_t> ParseHexCodeUnit(const std::string &jsonText, size_t &index) {
  if (index + 4 > jsonText.size()) {
    return std::nullopt;
  }

  uint32_t codeUnit = 0;
  for (size_t offset = 0; offset < 4; offset += 1) {
    const char current = jsonText[index + offset];
    codeUnit <<= 4;
    if (current >= '0' && current <= '9') {
      codeUnit |= static_cast<uint32_t>(current - '0');
      continue;
    }

    if (current >= 'a' && current <= 'f') {
      codeUnit |= static_cast<uint32_t>(current - 'a' + 10);
      continue;
    }

    if (current >= 'A' && current <= 'F') {
      codeUnit |= static_cast<uint32_t>(current - 'A' + 10);
      continue;
    }

    return std::nullopt;
  }

  index += 4;
  return codeUnit;
}

std::optional<std::string> ParseJsonString(const std::string &jsonText, size_t &index) {
  if (index >= jsonText.size() || jsonText[index] != '"') {
    return std::nullopt;
  }

  index += 1;
  std::string result;
  while (index < jsonText.size()) {
    const char current = jsonText[index++];
    if (current == '"') {
      return result;
    }

    if (current != '\\') {
      result.push_back(current);
      continue;
    }

    if (index >= jsonText.size()) {
      return std::nullopt;
    }

    const char escaped = jsonText[index++];
    switch (escaped) {
      case '"':
      case '\\':
      case '/':
        result.push_back(escaped);
        break;
      case 'b':
        result.push_back('\b');
        break;
      case 'f':
        result.push_back('\f');
        break;
      case 'n':
        result.push_back('\n');
        break;
      case 'r':
        result.push_back('\r');
        break;
      case 't':
        result.push_back('\t');
        break;
      case 'u': {
        auto codeUnit = ParseHexCodeUnit(jsonText, index);
        if (!codeUnit.has_value()) {
          return std::nullopt;
        }

        uint32_t codePoint = *codeUnit;
        if (codePoint >= 0xD800 && codePoint <= 0xDBFF) {
          if (index + 2 > jsonText.size() || jsonText[index] != '\\' || jsonText[index + 1] != 'u') {
            return std::nullopt;
          }

          index += 2;
          auto trailingCodeUnit = ParseHexCodeUnit(jsonText, index);
          if (!trailingCodeUnit.has_value() || *trailingCodeUnit < 0xDC00 || *trailingCodeUnit > 0xDFFF) {
            return std::nullopt;
          }

          codePoint = 0x10000 + ((codePoint - 0xD800) << 10) + (*trailingCodeUnit - 0xDC00);
        }

        AppendUtf8CodePoint(result, codePoint);
        break;
      }
      default:
        return std::nullopt;
    }
  }

  return std::nullopt;
}

std::optional<JSValue> ParseJsonValue(const std::string &jsonText, size_t &index);

std::optional<JSValue> ParseJsonArray(const std::string &jsonText, size_t &index) {
  if (index >= jsonText.size() || jsonText[index] != '[') {
    return std::nullopt;
  }

  index += 1;
  SkipJsonWhitespace(jsonText, index);

  JSValueArray array;
  if (index < jsonText.size() && jsonText[index] == ']') {
    index += 1;
    return JSValue{std::move(array)};
  }

  while (index < jsonText.size()) {
    auto value = ParseJsonValue(jsonText, index);
    if (!value.has_value()) {
      return std::nullopt;
    }

    array.push_back(std::move(*value));
    SkipJsonWhitespace(jsonText, index);

    if (index >= jsonText.size()) {
      return std::nullopt;
    }

    if (jsonText[index] == ']') {
      index += 1;
      return JSValue{std::move(array)};
    }

    if (jsonText[index] != ',') {
      return std::nullopt;
    }

    index += 1;
    SkipJsonWhitespace(jsonText, index);
  }

  return std::nullopt;
}

std::optional<JSValue> ParseJsonObject(const std::string &jsonText, size_t &index) {
  if (index >= jsonText.size() || jsonText[index] != '{') {
    return std::nullopt;
  }

  index += 1;
  SkipJsonWhitespace(jsonText, index);

  JSValueObject object;
  if (index < jsonText.size() && jsonText[index] == '}') {
    index += 1;
    return JSValue{std::move(object)};
  }

  while (index < jsonText.size()) {
    auto key = ParseJsonString(jsonText, index);
    if (!key.has_value()) {
      return std::nullopt;
    }

    SkipJsonWhitespace(jsonText, index);
    if (index >= jsonText.size() || jsonText[index] != ':') {
      return std::nullopt;
    }

    index += 1;
    SkipJsonWhitespace(jsonText, index);

    auto value = ParseJsonValue(jsonText, index);
    if (!value.has_value()) {
      return std::nullopt;
    }

    object.emplace(*key, std::move(*value));
    SkipJsonWhitespace(jsonText, index);

    if (index >= jsonText.size()) {
      return std::nullopt;
    }

    if (jsonText[index] == '}') {
      index += 1;
      return JSValue{std::move(object)};
    }

    if (jsonText[index] != ',') {
      return std::nullopt;
    }

    index += 1;
    SkipJsonWhitespace(jsonText, index);
  }

  return std::nullopt;
}

std::optional<JSValue> ParseJsonNumber(const std::string &jsonText, size_t &index) {
  const size_t start = index;
  if (index < jsonText.size() && jsonText[index] == '-') {
    index += 1;
  }

  if (index >= jsonText.size()) {
    return std::nullopt;
  }

  if (jsonText[index] == '0') {
    index += 1;
  } else {
    if (!std::isdigit(static_cast<unsigned char>(jsonText[index]))) {
      return std::nullopt;
    }

    while (index < jsonText.size() && std::isdigit(static_cast<unsigned char>(jsonText[index])) != 0) {
      index += 1;
    }
  }

  if (index < jsonText.size() && jsonText[index] == '.') {
    index += 1;
    if (index >= jsonText.size() || std::isdigit(static_cast<unsigned char>(jsonText[index])) == 0) {
      return std::nullopt;
    }

    while (index < jsonText.size() && std::isdigit(static_cast<unsigned char>(jsonText[index])) != 0) {
      index += 1;
    }
  }

  if (index < jsonText.size() && (jsonText[index] == 'e' || jsonText[index] == 'E')) {
    index += 1;
    if (index < jsonText.size() && (jsonText[index] == '+' || jsonText[index] == '-')) {
      index += 1;
    }

    if (index >= jsonText.size() || std::isdigit(static_cast<unsigned char>(jsonText[index])) == 0) {
      return std::nullopt;
    }

    while (index < jsonText.size() && std::isdigit(static_cast<unsigned char>(jsonText[index])) != 0) {
      index += 1;
    }
  }

  const auto numberText = jsonText.substr(start, index - start);
  char *parseEnd = nullptr;
  const double value = std::strtod(numberText.c_str(), &parseEnd);
  if (parseEnd == nullptr || *parseEnd != '\0') {
    return std::nullopt;
  }

  return JSValue{value};
}

std::optional<JSValue> ParseJsonValue(const std::string &jsonText, size_t &index) {
  SkipJsonWhitespace(jsonText, index);
  if (index >= jsonText.size()) {
    return std::nullopt;
  }

  const char current = jsonText[index];
  if (current == '{') {
    return ParseJsonObject(jsonText, index);
  }

  if (current == '[') {
    return ParseJsonArray(jsonText, index);
  }

  if (current == '"') {
    auto value = ParseJsonString(jsonText, index);
    return value.has_value() ? std::optional<JSValue>{JSValue{*value}} : std::nullopt;
  }

  if (current == 't' && jsonText.compare(index, 4, "true") == 0) {
    index += 4;
    return JSValue{true};
  }

  if (current == 'f' && jsonText.compare(index, 5, "false") == 0) {
    index += 5;
    return JSValue{false};
  }

  if (current == 'n' && jsonText.compare(index, 4, "null") == 0) {
    index += 4;
    return JSValue{};
  }

  if (current == '-' || std::isdigit(static_cast<unsigned char>(current)) != 0) {
    return ParseJsonNumber(jsonText, index);
  }

  return std::nullopt;
}

JSValue ParseJson(const std::string &jsonText) {
  const auto trimmed = Trim(jsonText);
  if (trimmed.empty()) {
    return JSValue{};
  }

  size_t index = 0;
  auto value = ParseJsonValue(trimmed, index);
  if (!value.has_value()) {
    return JSValue{};
  }

  SkipJsonWhitespace(trimmed, index);
  return index == trimmed.size() ? std::move(*value) : JSValue{};
}

JSValueArray ParseImageArray(const std::string &jsonText, const std::string &imagesDirectoryPath) {
  if (jsonText.empty()) {
    return JSValueArray{};
  }

  JSValueArray result;
  for (const auto &objectText : SplitJsonObjects(jsonText)) {
    const auto localPath = ExtractJsonStringField(objectText, "localPath");
    if (!localPath.has_value() || localPath->rfind(kImageApiPrefix, 0) != 0) {
      continue;
    }

    const auto relativePath = localPath->substr(std::strlen(kImageApiPrefix));
    JSValueObject image{
        {"type", ExtractJsonStringField(objectText, "type").value_or(std::string{})},
        {"variant", ExtractJsonStringField(objectText, "variant").value_or(std::string{})},
        {"filePath", JoinImagePath(imagesDirectoryPath, relativePath)},
    };

    const auto sourceUrl = ExtractJsonStringField(objectText, "sourceUrl");
    if (sourceUrl.has_value() && !sourceUrl->empty()) {
      image["sourceUrl"] = *sourceUrl;
    } else {
      image["sourceUrl"] = JSValue{};
    }

    result.push_back(JSValue{std::move(image)});
  }

  return result;
}

std::unordered_map<int, JSValueArray> LoadTags(sqlite3 *database) {
  std::unordered_map<int, JSValueArray> tagsByNoteId;
  if (!TableExists(database, "banknote_tags") || !TableExists(database, "tags")) {
    return tagsByNoteId;
  }

  auto statement = Prepare(
      database,
      "SELECT bt.banknote_id, t.id, t.name FROM banknote_tags bt INNER JOIN tags t ON t.id = bt.tag_id ORDER BY t.name COLLATE NOCASE ASC");
  if (!statement.has_value()) {
    return tagsByNoteId;
  }

  while (sqlite3_step(statement->value) == SQLITE_ROW) {
    const int noteId = sqlite3_column_int(statement->value, 0);
    const int tagId = sqlite3_column_int(statement->value, 1);
    const auto tagName = ColumnText(statement->value, 2);

    JSValueObject tag{{"id", tagId}, {"name", tagName}};
    tagsByNoteId[noteId].push_back(JSValue{std::move(tag)});
  }

  return tagsByNoteId;
}

std::vector<CollectionRecord> LoadCollections(sqlite3 *database) {
  std::vector<CollectionRecord> collections;
  if (!TableExists(database, "collections")) {
    return collections;
  }

  const bool hasDefaultColumn = ColumnExists(database, "collections", "is_default");
  auto statement = Prepare(
      database,
      hasDefaultColumn
          ? "SELECT id, name, is_default FROM collections ORDER BY is_default DESC, name COLLATE NOCASE ASC, id ASC"
          : "SELECT id, name FROM collections ORDER BY name COLLATE NOCASE ASC, id ASC");
  if (!statement.has_value()) {
    return collections;
  }

  while (sqlite3_step(statement->value) == SQLITE_ROW) {
    CollectionRecord collection;
    collection.id = sqlite3_column_int(statement->value, 0);
    collection.name = ColumnText(statement->value, 1);
    collection.isDefault = hasDefaultColumn && sqlite3_column_int(statement->value, 2) == 1;

    if (collection.id > 0) {
      collections.push_back(std::move(collection));
    }
  }

  return collections;
}

} // namespace

namespace ViewerReactNative {

void NoteHarborImportedDatasetReader::readImportedDataset(
    JSValueObject &&location,
    ::React::ReactPromise<JSValueObject> &&result) noexcept {
  const auto databasePath = StringValue(location, "databasePath");
  const auto imagesDirectoryPath = StringValue(location, "imagesDirectoryPath");

  if (databasePath.empty() || imagesDirectoryPath.empty()) {
    result.Reject("Database and images paths are required.");
    return;
  }

  sqlite3 *rawDatabase = nullptr;
  if (sqlite3_open_v2(databasePath.c_str(), &rawDatabase, SQLITE_OPEN_READONLY, nullptr) != SQLITE_OK) {
    if (rawDatabase != nullptr) {
      sqlite3_close(rawDatabase);
    }
    result.Reject("Unable to open imported dataset database.");
    return;
  }

  DatabaseHandle database{rawDatabase};
  if (!TableExists(database.value, "banknotes")) {
    result.Reject("Imported dataset does not contain a banknotes table.");
    return;
  }

  const bool hasCollectionsTable = TableExists(database.value, "collections");
  const bool banknotesHasCollectionId = ColumnExists(database.value, "banknotes", "collection_id");

  auto collections = hasCollectionsTable ? LoadCollections(database.value) : std::vector<CollectionRecord>{{1, "Default", true}};
  if (collections.empty()) {
    collections.push_back(CollectionRecord{1, "Default", true});
  }

  auto tagsByNoteId = LoadTags(database.value);
  std::unordered_map<int, int> noteCountByCollectionId;

  auto noteStatement = Prepare(
      database.value,
      banknotesHasCollectionId
          ? "SELECT id, collection_id, display_order, denomination, issue_date, catalog_number, grading_company, grade, watermark, serial, url, notes, scraped_data, images, scrape_status, scrape_error FROM banknotes ORDER BY collection_id ASC, display_order ASC, id ASC"
          : "SELECT id, display_order, denomination, issue_date, catalog_number, grading_company, grade, watermark, serial, url, notes, scraped_data, images, scrape_status, scrape_error FROM banknotes ORDER BY display_order ASC, id ASC");
  if (!noteStatement.has_value()) {
    result.Reject("Unable to read imported dataset notes.");
    return;
  }

  JSValueArray notes;
  while (sqlite3_step(noteStatement->value) == SQLITE_ROW) {
    int columnIndex = 0;
    const int noteId = sqlite3_column_int(noteStatement->value, columnIndex++);
    const int collectionId = banknotesHasCollectionId ? sqlite3_column_int(noteStatement->value, columnIndex++) : 1;
    const int displayOrder = sqlite3_column_int(noteStatement->value, columnIndex++);
    const auto denomination = ColumnText(noteStatement->value, columnIndex++);
    const auto issueDate = ColumnText(noteStatement->value, columnIndex++);
    const auto catalogNumber = ColumnText(noteStatement->value, columnIndex++);
    const auto gradingCompany = ColumnText(noteStatement->value, columnIndex++);
    const auto grade = ColumnText(noteStatement->value, columnIndex++);
    const auto watermark = ColumnText(noteStatement->value, columnIndex++);
    const auto serial = ColumnText(noteStatement->value, columnIndex++);
    const auto url = ColumnText(noteStatement->value, columnIndex++);
    const auto noteText = ColumnText(noteStatement->value, columnIndex++);
    const auto scrapedDataText = ColumnText(noteStatement->value, columnIndex++);
    const auto imagesText = ColumnText(noteStatement->value, columnIndex++);
    const auto scrapeStatus = ColumnText(noteStatement->value, columnIndex++);
    const auto scrapeError = ColumnText(noteStatement->value, columnIndex++);

    noteCountByCollectionId[collectionId] += 1;

    JSValueObject note{
        {"id", noteId},
        {"collectionId", collectionId},
        {"displayOrder", displayOrder},
        {"denomination", denomination},
        {"issueDate", issueDate},
        {"catalogNumber", catalogNumber},
        {"gradingCompany", gradingCompany},
        {"grade", grade},
        {"watermark", watermark},
        {"serial", serial},
        {"url", url},
        {"notes", noteText},
        {"scrapeStatus", scrapeStatus},
        {"scrapeError", scrapeError},
        {"scrapedData", ParseJson(scrapedDataText)},
        {"tags", tagsByNoteId.count(noteId) ? JSValue{tagsByNoteId[noteId].Copy()} : JSValue{JSValueArray{}}},
        {"images", JSValue{ParseImageArray(imagesText, imagesDirectoryPath)}},
    };

    notes.push_back(JSValue{std::move(note)});
  }

  const bool hasExplicitDefault = std::any_of(
      collections.begin(),
      collections.end(),
      [](const CollectionRecord &collection) { return collection.isDefault; });

  JSValueArray jsCollections;
  for (size_t index = 0; index < collections.size(); ++index) {
    const auto &collection = collections[index];
    JSValueObject jsCollection{
        {"id", collection.id},
        {"name", collection.name},
        {"noteCount", noteCountByCollectionId[collection.id]},
        {"isDefault", collection.isDefault || (!hasExplicitDefault && index == 0)},
    };
    jsCollections.push_back(JSValue{std::move(jsCollection)});
  }

  JSValueObject snapshot{
      {"generatedAt", JSValue{}},
      {"noteCount", static_cast<int>(notes.size())},
      {"collections", JSValue{std::move(jsCollections)}},
      {"notes", JSValue{std::move(notes)}},
      {"source", "imported"},
  };

  result.Resolve(std::move(snapshot));
}

} // namespace ViewerReactNative
