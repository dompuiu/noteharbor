#pragma once

#include <NativeModules.h>

namespace ViewerReactNative {

REACT_MODULE(NoteHarborImportedDatasetReader)
struct NoteHarborImportedDatasetReader {
  REACT_METHOD(readImportedDataset)
  void readImportedDataset(
      ::React::JSValueObject &&location,
      ::React::ReactPromise<::React::JSValueObject> &&result) noexcept;
};

} // namespace ViewerReactNative
