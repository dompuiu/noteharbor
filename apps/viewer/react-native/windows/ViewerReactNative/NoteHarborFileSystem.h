#pragma once

#include <NativeModules.h>
#include <string>

namespace ViewerReactNative {

REACT_MODULE(NoteHarborFileSystem)
struct NoteHarborFileSystem {
  static std::string GetDefaultDocumentDirectoryPath() noexcept;
  REACT_CONSTANT(DocumentDirectoryPath);
  // Initialized at construction (not in REACT_INIT) so the constant is
  // populated before JavaScript reads it, regardless of init ordering.
  std::string DocumentDirectoryPath = GetDefaultDocumentDirectoryPath();
  REACT_METHOD(exists, L"exists")
  void exists(std::string &&path, ::React::ReactPromise<bool> &&result) noexcept;
  REACT_METHOD(mkdir, L"mkdir")
  void mkdir(std::string &&path, ::React::ReactPromise<void> &&result) noexcept;
  REACT_METHOD(readDir, L"readDir")
  void readDir(std::string &&path, ::React::ReactPromise<::React::JSValueArray> &&result) noexcept;
  REACT_METHOD(readFile, L"readFile")
  void readFile(std::string &&path, std::string &&encoding, ::React::ReactPromise<std::string> &&result) noexcept;
  REACT_METHOD(writeFile, L"writeFile")
  void writeFile(
      std::string &&path,
      std::string &&contents,
      std::string &&encoding,
      ::React::ReactPromise<void> &&result) noexcept;
  REACT_METHOD(unlink, L"unlink")
  void unlink(std::string &&path, ::React::ReactPromise<void> &&result) noexcept;
  REACT_METHOD(moveFile, L"moveFile")
  void moveFile(std::string &&src, std::string &&dest, ::React::ReactPromise<void> &&result) noexcept;
  REACT_SYNC_METHOD(getDocumentDirectoryPath)
  std::string getDocumentDirectoryPath() noexcept;
};

} // namespace ViewerReactNative
