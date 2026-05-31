#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>

#import "../../apple/NoteHarborImportedDatasetSnapshot.h"

@interface NoteHarborImportedDatasetReader : NSObject <RCTBridgeModule>
@end

@implementation NoteHarborImportedDatasetReader

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup {
  return NO;
}

RCT_REMAP_METHOD(readImportedDataset,
                 readImportedDataset:(NSDictionary *)location
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  NSError *error = nil;
  NSDictionary *snapshot = NHBuildImportedDatasetSnapshot(location, &error);
  if (snapshot == nil) {
    reject(@"sqlite_read_failed", error.localizedDescription ?: @"Failed to read imported dataset.", error);
    return;
  }

  resolve(snapshot);
}

@end
