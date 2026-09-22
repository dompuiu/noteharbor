#pragma once

#include <NativeModules.h>
#include <string>

namespace ViewerReactNative {

REACT_MODULE(NoteHarborFileSystem)
struct NoteHarborFileSystem {
  REACT_CONSTANT(DocumentDirectoryPath);
  std::string DocumentDirectoryPath;
  REACT_INIT(Initialize);
  void Initialize(::React::ReactContext const &) noexcept;
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
};

} // namespace ViewerReactNative
