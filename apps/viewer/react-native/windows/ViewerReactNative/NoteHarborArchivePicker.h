#pragma once

#include <NativeModules.h>

namespace ViewerReactNative {

REACT_MODULE(NoteHarborArchivePicker)
struct NoteHarborArchivePicker {
  REACT_METHOD(pickArchiveFile)
  void pickArchiveFile(::React::ReactPromise<::React::JSValue> &&result) noexcept;
};

} // namespace ViewerReactNative
