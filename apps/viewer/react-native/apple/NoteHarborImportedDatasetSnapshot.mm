#import "NoteHarborImportedDatasetSnapshot.h"

#import <sqlite3.h>

static NSString *const NHImageApiPrefix = @"/api/images/";

static NSString *NHStringValue(id value) {
  if (value == nil || value == [NSNull null]) {
    return @"";
  }

  if ([value isKindOfClass:[NSString class]]) {
    return [(NSString *)value stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  }

  return [[NSString stringWithFormat:@"%@", value] stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
}

static id NHParseJsonString(NSString *rawValue) {
  if (rawValue.length == 0) {
    return nil;
  }

  NSData *data = [rawValue dataUsingEncoding:NSUTF8StringEncoding];
  if (data == nil) {
    return nil;
  }

  return [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
}

static NSArray<NSDictionary<NSString *, id> *> *NHParseJsonArray(NSString *rawValue) {
  id parsed = NHParseJsonString(rawValue);
  if (![parsed isKindOfClass:[NSArray class]]) {
    return @[];
  }

  NSMutableArray<NSDictionary<NSString *, id> *> *result = [NSMutableArray array];
  for (id entry in (NSArray *)parsed) {
    if ([entry isKindOfClass:[NSDictionary class]]) {
      [result addObject:(NSDictionary<NSString *, id> *)entry];
    }
  }

  return result;
}

static BOOL NHTableExists(sqlite3 *database, NSString *tableName) {
  sqlite3_stmt *statement = NULL;
  BOOL exists = NO;

  if (sqlite3_prepare_v2(database, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1", -1, &statement, NULL) == SQLITE_OK) {
    sqlite3_bind_text(statement, 1, tableName.UTF8String, -1, SQLITE_TRANSIENT);
    exists = sqlite3_step(statement) == SQLITE_ROW;
  }

  sqlite3_finalize(statement);
  return exists;
}

static BOOL NHColumnExists(sqlite3 *database, NSString *tableName, NSString *columnName) {
  sqlite3_stmt *statement = NULL;
  BOOL exists = NO;
  NSString *query = [NSString stringWithFormat:@"PRAGMA table_info(%@)", tableName];

  if (sqlite3_prepare_v2(database, query.UTF8String, -1, &statement, NULL) == SQLITE_OK) {
    while (sqlite3_step(statement) == SQLITE_ROW) {
      const unsigned char *name = sqlite3_column_text(statement, 1);
      if (name == NULL) {
        continue;
      }

      NSString *currentName = [NSString stringWithUTF8String:(const char *)name];
      if ([[currentName lowercaseString] isEqualToString:[columnName lowercaseString]]) {
        exists = YES;
        break;
      }
    }
  }

  sqlite3_finalize(statement);
  return exists;
}

static NSString *NHFileTimestamp(NSString *path) {
  NSDictionary<NSFileAttributeKey, id> *attributes = [[NSFileManager defaultManager] attributesOfItemAtPath:path error:nil];
  NSDate *modifiedAt = attributes[NSFileModificationDate];
  if (modifiedAt == nil) {
    return nil;
  }

  NSISO8601DateFormatter *formatter = [NSISO8601DateFormatter new];
  formatter.formatOptions = NSISO8601DateFormatWithInternetDateTime;
  return [formatter stringFromDate:modifiedAt];
}

static NSString *NHJoinedImagePath(NSString *imagesDirectoryPath, NSString *relativePath) {
  NSArray<NSString *> *components = [relativePath componentsSeparatedByString:@"/"];
  NSString *result = imagesDirectoryPath;

  for (NSString *component in components) {
    if (component.length == 0) {
      continue;
    }

    result = [result stringByAppendingPathComponent:component];
  }

  return result;
}

static NSDictionary<NSNumber *, NSArray<NSDictionary<NSString *, id> *> *> *NHLoadTags(sqlite3 *database) {
  if (!NHTableExists(database, @"banknote_tags") || !NHTableExists(database, @"tags")) {
    return @{};
  }

  sqlite3_stmt *statement = NULL;
  NSMutableDictionary<NSNumber *, NSMutableArray<NSDictionary<NSString *, id> *> *> *tagMap = [NSMutableDictionary dictionary];

  if (sqlite3_prepare_v2(database, "SELECT bt.banknote_id, t.id, t.name FROM banknote_tags bt INNER JOIN tags t ON t.id = bt.tag_id ORDER BY t.name COLLATE NOCASE ASC", -1, &statement, NULL) == SQLITE_OK) {
    while (sqlite3_step(statement) == SQLITE_ROW) {
      int banknoteId = sqlite3_column_int(statement, 0);
      int tagId = sqlite3_column_int(statement, 1);
      const unsigned char *tagName = sqlite3_column_text(statement, 2);

      NSNumber *key = @(banknoteId);
      NSMutableArray *tags = tagMap[key] ?: [NSMutableArray array];
      tagMap[key] = tags;
      [tags addObject:@{
        @"id": @(tagId),
        @"name": tagName ? [NSString stringWithUTF8String:(const char *)tagName] : @"",
      }];
    }
  }

  sqlite3_finalize(statement);
  return tagMap;
}

static NSArray<NSDictionary<NSString *, id> *> *NHLoadCollections(sqlite3 *database) {
  if (!NHTableExists(database, @"collections")) {
    return @[];
  }

  BOOL hasDefaultColumn = NHColumnExists(database, @"collections", @"is_default");
  sqlite3_stmt *statement = NULL;
  NSMutableArray<NSDictionary<NSString *, id> *> *collections = [NSMutableArray array];
  const char *query = hasDefaultColumn
    ? "SELECT id, name, is_default FROM collections ORDER BY is_default DESC, name COLLATE NOCASE ASC, id ASC"
    : "SELECT id, name FROM collections ORDER BY name COLLATE NOCASE ASC, id ASC";

  if (sqlite3_prepare_v2(database, query, -1, &statement, NULL) == SQLITE_OK) {
    while (sqlite3_step(statement) == SQLITE_ROW) {
      int collectionId = sqlite3_column_int(statement, 0);
      const unsigned char *collectionName = sqlite3_column_text(statement, 1);
      BOOL isDefault = hasDefaultColumn && sqlite3_column_int(statement, 2) == 1;

      if (collectionId <= 0) {
        continue;
      }

      [collections addObject:@{
        @"id": @(collectionId),
        @"name": collectionName ? [NSString stringWithUTF8String:(const char *)collectionName] : @"",
        @"noteCount": @0,
        @"isDefault": @(isDefault),
      }];
    }
  }

  sqlite3_finalize(statement);
  return collections;
}

NSDictionary *NHBuildImportedDatasetSnapshot(NSDictionary *location, NSError **error) {
  NSString *databasePath = NHStringValue(location[@"databasePath"]);
  NSString *imagesDirectoryPath = NHStringValue(location[@"imagesDirectoryPath"]);

  if (databasePath.length == 0 || imagesDirectoryPath.length == 0) {
    if (error != NULL) {
      *error = [NSError errorWithDomain:@"NoteHarborImportedDatasetReader" code:1 userInfo:@{NSLocalizedDescriptionKey: @"Database and images paths are required."}];
    }
    return nil;
  }

  sqlite3 *database = NULL;
  if (sqlite3_open_v2(databasePath.UTF8String, &database, SQLITE_OPEN_READONLY, NULL) != SQLITE_OK) {
    if (error != NULL) {
      *error = [NSError errorWithDomain:@"NoteHarborImportedDatasetReader" code:2 userInfo:@{NSLocalizedDescriptionKey: @"Unable to open imported dataset database."}];
    }
    if (database != NULL) {
      sqlite3_close(database);
    }
    return nil;
  }

  @try {
    if (!NHTableExists(database, @"banknotes")) {
      if (error != NULL) {
        *error = [NSError errorWithDomain:@"NoteHarborImportedDatasetReader" code:3 userInfo:@{NSLocalizedDescriptionKey: @"Imported dataset does not contain a banknotes table."}];
      }
      return nil;
    }

    BOOL hasCollectionsTable = NHTableExists(database, @"collections");
    BOOL banknotesHasCollectionId = NHColumnExists(database, @"banknotes", @"collection_id");
    NSArray<NSDictionary<NSString *, id> *> *collections = hasCollectionsTable ? NHLoadCollections(database) : @[@{
      @"id": @1,
      @"name": @"Default",
      @"noteCount": @0,
      @"isDefault": @YES,
    }];
    if (collections.count == 0) {
      collections = @[@{
        @"id": @1,
        @"name": @"Default",
        @"noteCount": @0,
        @"isDefault": @YES,
      }];
    }

    NSDictionary<NSNumber *, NSArray<NSDictionary<NSString *, id> *> *> *tagMap = NHLoadTags(database);
    NSMutableDictionary<NSNumber *, NSNumber *> *noteCounts = [NSMutableDictionary dictionary];
    NSMutableArray<NSDictionary<NSString *, id> *> *notes = [NSMutableArray array];

    NSString *query = banknotesHasCollectionId
      ? @"SELECT id, collection_id, display_order, denomination, issue_date, catalog_number, grading_company, grade, watermark, serial, url, notes, scraped_data, images, scrape_status, scrape_error FROM banknotes ORDER BY collection_id ASC, display_order ASC, id ASC"
      : @"SELECT id, display_order, denomination, issue_date, catalog_number, grading_company, grade, watermark, serial, url, notes, scraped_data, images, scrape_status, scrape_error FROM banknotes ORDER BY display_order ASC, id ASC";
    sqlite3_stmt *statement = NULL;

    if (sqlite3_prepare_v2(database, query.UTF8String, -1, &statement, NULL) != SQLITE_OK) {
      if (error != NULL) {
        *error = [NSError errorWithDomain:@"NoteHarborImportedDatasetReader" code:4 userInfo:@{NSLocalizedDescriptionKey: @"Failed to query imported banknotes."}];
      }
      sqlite3_finalize(statement);
      return nil;
    }

    while (sqlite3_step(statement) == SQLITE_ROW) {
      int column = 0;
      int noteId = sqlite3_column_int(statement, column++);
      int collectionId = banknotesHasCollectionId ? sqlite3_column_int(statement, column++) : 1;
      int displayOrder = sqlite3_column_int(statement, column++);

      NSString *(^columnText)(int) = ^NSString *(int index) {
        const unsigned char *text = sqlite3_column_text(statement, index);
        return text ? [NSString stringWithUTF8String:(const char *)text] : @"";
      };

      NSString *denomination = columnText(column++);
      NSString *issueDate = columnText(column++);
      NSString *catalogNumber = columnText(column++);
      NSString *gradingCompany = columnText(column++);
      NSString *grade = columnText(column++);
      NSString *watermark = columnText(column++);
      NSString *serial = columnText(column++);
      NSString *url = columnText(column++);
      NSString *noteText = columnText(column++);
      NSString *scrapedData = columnText(column++);
      NSString *imagesText = columnText(column++);
      NSString *scrapeStatus = columnText(column++);
      NSString *scrapeError = columnText(column++);

      NSMutableArray<NSDictionary<NSString *, id> *> *images = [NSMutableArray array];
      for (NSDictionary<NSString *, id> *image in NHParseJsonArray(imagesText)) {
        NSString *localPath = NHStringValue(image[@"localPath"]);
        if (![localPath hasPrefix:NHImageApiPrefix]) {
          continue;
        }

        NSString *relativePath = [localPath substringFromIndex:NHImageApiPrefix.length];
        [images addObject:@{
          @"type": NHStringValue(image[@"type"]),
          @"variant": NHStringValue(image[@"variant"]),
          @"filePath": NHJoinedImagePath(imagesDirectoryPath, relativePath),
          @"sourceUrl": NHStringValue(image[@"sourceUrl"]).length > 0 ? NHStringValue(image[@"sourceUrl"]) : [NSNull null],
        }];
      }

      NSNumber *collectionKey = @(collectionId);
      noteCounts[collectionKey] = @([noteCounts[collectionKey] integerValue] + 1);

      [notes addObject:@{
        @"id": @(noteId),
        @"collectionId": @(collectionId),
        @"displayOrder": @(displayOrder),
        @"denomination": denomination,
        @"issueDate": issueDate,
        @"catalogNumber": catalogNumber,
        @"gradingCompany": gradingCompany,
        @"grade": grade,
        @"watermark": watermark,
        @"serial": serial,
        @"url": url,
        @"notes": noteText,
        @"scrapeStatus": scrapeStatus,
        @"scrapeError": scrapeError,
        @"scrapedData": NHParseJsonString(scrapedData) ?: [NSNull null],
        @"tags": tagMap[@(noteId)] ?: @[],
        @"images": images,
      }];
    }

    sqlite3_finalize(statement);

    BOOL hasDefaultCollection = NO;
    for (NSDictionary<NSString *, id> *collection in collections) {
      if ([collection[@"isDefault"] boolValue]) {
        hasDefaultCollection = YES;
        break;
      }
    }

    NSNumber *fallbackDefaultId = [collections.firstObject[@"id"] isKindOfClass:[NSNumber class]] ? collections.firstObject[@"id"] : nil;

    NSMutableArray<NSDictionary<NSString *, id> *> *hydratedCollections = [NSMutableArray array];
    for (NSDictionary<NSString *, id> *collection in collections) {
      NSNumber *collectionId = collection[@"id"];
      [hydratedCollections addObject:@{
        @"id": collectionId,
        @"name": collection[@"name"] ?: @"",
        @"noteCount": noteCounts[collectionId] ?: @0,
        @"isDefault": @((collection[@"isDefault"] != nil ? [collection[@"isDefault"] boolValue] : NO) || (!hasDefaultCollection && fallbackDefaultId != nil && [collectionId isEqual:fallbackDefaultId])),
      }];
    }

    return @{
      @"generatedAt": NHFileTimestamp(databasePath) ?: [NSNull null],
      @"noteCount": @(notes.count),
      @"notes": notes,
      @"collections": hydratedCollections,
      @"source": @"imported",
    };
  } @finally {
    sqlite3_close(database);
  }
}
