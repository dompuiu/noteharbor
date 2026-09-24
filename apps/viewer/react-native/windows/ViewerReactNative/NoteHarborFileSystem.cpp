#include "pch.h"

#include "NoteHarborFileSystem.h"

#include <appmodel.h>
#include <shlobj.h>
#include <wincrypt.h>

#include <filesystem>
#include <string>
#include <vector>

using namespace winrt::Microsoft::ReactNative;

namespace {

std::wstring Utf8ToWide(const std::string &value) {
  if (value.empty()) {
    return {};
  }
  const int size = ::MultiByteToWideChar(
      CP_UTF8, 0, value.c_str(), static_cast<int>(value.size()), nullptr, 0);
  std::wstring result(static_cast<size_t>(size), L'\0');
  ::MultiByteToWideChar(CP_UTF8, 0, value.c_str(), static_cast<int>(value.size()), result.data(), size);
  return result;
}

std::string WideToUtf8(const std::wstring &value) {
  if (value.empty()) {
    return {};
  }
  const int size = ::WideCharToMultiByte(
      CP_UTF8, 0, value.c_str(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
  std::string result(static_cast<size_t>(size), '\0');
  ::WideCharToMultiByte(CP_UTF8, 0, value.c_str(), static_cast<int>(value.size()), result.data(), size, nullptr,
      nullptr);
  return result;
}

std::filesystem::path ToPath(const std::string &value) {
  std::string normalized = value;
  for (char &c : normalized) {
    if (c == '/') {
      c = '\\';
    }
  }
  return std::filesystem::path(Utf8ToWide(normalized));
}

std::string FromPath(const std::filesystem::path &path) {
  return WideToUtf8(path.wstring());
}

std::wstring QuoteNativeArg(const std::wstring &value) {
  std::wstring result;
  result.reserve(value.size() + 2);
  result.push_back(L'"');
  result.append(value);
  result.push_back(L'"');
  return result;
}

std::string TrimAscii(std::string value) {
  const auto isSpace = [](char c) {
    return c == ' ' || c == '\t' || c == '\r' || c == '\n';
  };
  while (!value.empty() && isSpace(value.front())) {
    value.erase(value.begin());
  }
  while (!value.empty() && isSpace(value.back())) {
    value.pop_back();
  }
  return value;
}

std::vector<uint8_t> ReadAllBytes(const std::filesystem::path &path, bool &ok) {
  ok = false;
  HANDLE file = ::CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING,
      FILE_ATTRIBUTE_NORMAL, nullptr);
  if (file == INVALID_HANDLE_VALUE) {
    return {};
  }
  LARGE_INTEGER size = {};
  if (::GetFileSizeEx(file, &size) == FALSE) {
    ::CloseHandle(file);
    return {};
  }
  std::vector<uint8_t> bytes(static_cast<size_t>(size.QuadPart));
  DWORD read = 0;
  size_t offset = 0;
  while (offset < bytes.size()) {
    DWORD chunk = 0;
    if (::ReadFile(file, bytes.data() + offset, static_cast<DWORD>(bytes.size() - offset), &chunk, nullptr) ==
            FALSE ||
        chunk == 0) {
      ::CloseHandle(file);
      return {};
    }
    offset += chunk;
    (void)read;
  }
  ::CloseHandle(file);
  ok = true;
  return bytes;
}

bool WriteAllBytes(const std::filesystem::path &path, const uint8_t *data, size_t size) {
  std::error_code ec;
  std::filesystem::create_directories(path.parent_path(), ec);
  HANDLE file = ::CreateFileW(path.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (file == INVALID_HANDLE_VALUE) {
    return false;
  }
  size_t offset = 0;
  while (offset < size) {
    DWORD chunk = 0;
    if (::WriteFile(file, data + offset, static_cast<DWORD>(size - offset), &chunk, nullptr) == FALSE) {
      ::CloseHandle(file);
      return false;
    }
    offset += chunk;
  }
  ::CloseHandle(file);
  return true;
}

std::string Base64Encode(const std::vector<uint8_t> &bytes) {
  if (bytes.empty()) {
    return {};
  }
  DWORD length = 0;
  if (::CryptBinaryToStringW(bytes.data(), static_cast<DWORD>(bytes.size()),
          CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF, nullptr, &length) == FALSE) {
    return {};
  }
  std::wstring wide(length, L'\0');
  if (::CryptBinaryToStringW(bytes.data(), static_cast<DWORD>(bytes.size()),
          CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF, wide.data(), &length) == FALSE) {
    return {};
  }
  while (!wide.empty() && wide.back() == L'\0') {
    wide.pop_back();
  }
  return WideToUtf8(wide);
}

std::vector<uint8_t> Base64Decode(const std::string &value, bool &ok) {
  ok = false;
  const std::wstring wide = Utf8ToWide(value);
  DWORD length = 0;
  if (::CryptStringToBinaryW(wide.c_str(), 0, CRYPT_STRING_BASE64_ANY, nullptr, &length, nullptr, nullptr) == FALSE) {
    return {};
  }
  std::vector<uint8_t> bytes(length);
  if (::CryptStringToBinaryW(
          wide.c_str(), 0, CRYPT_STRING_BASE64_ANY, bytes.data(), &length, nullptr, nullptr) == FALSE) {
    return {};
  }
  bytes.resize(length);
  ok = true;
  return bytes;
}

} // namespace

namespace ViewerReactNative {

std::wstring GetLocalAppDataDir() {
  PWSTR rawPath = nullptr;
  if (::SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, &rawPath) == S_OK && rawPath != nullptr) {
    std::wstring result{rawPath};
    ::CoTaskMemFree(rawPath);
    if (!result.empty()) {
      return result;
    }
  } else if (rawPath != nullptr) {
    ::CoTaskMemFree(rawPath);
  }

  wchar_t envBuffer[MAX_PATH * 4] = {};
  if (::GetEnvironmentVariableW(L"LOCALAPPDATA", envBuffer, ARRAYSIZE(envBuffer)) > 0) {
    return std::wstring{envBuffer};
  }

  if (::SHGetKnownFolderPath(FOLDERID_Profile, 0, nullptr, &rawPath) == S_OK && rawPath != nullptr) {
    std::wstring result = std::wstring{rawPath} + L"\\AppData\\Local";
    ::CoTaskMemFree(rawPath);
    if (!result.empty()) {
      return result;
    }
  } else if (rawPath != nullptr) {
    ::CoTaskMemFree(rawPath);
  }

  wchar_t tempBuffer[MAX_PATH * 4] = {};
  if (::GetTempPathW(ARRAYSIZE(tempBuffer), tempBuffer) > 0) {
    return std::wstring{tempBuffer};
  }

  return {};
}

std::string NoteHarborFileSystem::GetDefaultDocumentDirectoryPath() noexcept {
  try {
    const std::wstring dir = GetLocalAppDataDir();
    if (dir.empty()) {
      return {};
    }
    std::filesystem::path base{dir};
    base /= L"ViewerReactNative";
    std::error_code ec;
    std::filesystem::create_directories(base, ec);
    // Return the path even if creation reported an error; file
    // operations will surface real failures with precise messages.
    return WideToUtf8(base.wstring());
  } catch (...) {
  }
  return {};
}

namespace {
// Maps an app-view %LOCALAPPDATA% path to the on-disk backing store so an
// out-of-process helper (tar.exe) resolves the same files the packaged app
// sees. Unpackaged runs (or non-redirected paths) pass through untouched.
std::filesystem::path ToBackingStorePath(const std::filesystem::path &virtualPath) {
  UINT32 familyLength = 0;
  if (::GetCurrentPackageFamilyName(&familyLength, nullptr) != ERROR_INSUFFICIENT_BUFFER ||
      familyLength <= 1) {
    return virtualPath;
  }

  std::wstring family(familyLength, L'\0');
  if (::GetCurrentPackageFamilyName(&familyLength, family.data()) != ERROR_SUCCESS) {
    return virtualPath;
  }
  while (!family.empty() && family.back() == L'\0') {
    family.pop_back();
  }
  if (family.empty()) {
    return virtualPath;
  }

  const std::wstring base = GetLocalAppDataDir();
  if (base.empty()) {
    return virtualPath;
  }
  const std::wstring value = virtualPath.wstring();
  if (value.size() <= base.size() || ::_wcsnicmp(value.c_str(), base.c_str(), base.size()) != 0 ||
      (value[base.size()] != L'\\' && value[base.size()] != L'/')) {
    return virtualPath;
  }

  return std::filesystem::path(
      base + L"\\Packages\\" + family + L"\\LocalCache\\Local" + value.substr(base.size()));
}
} // namespace

void NoteHarborFileSystem::exists(std::string &&path, ::React::ReactPromise<bool> &&result) noexcept {  try {
    std::error_code ec;
    result.Resolve(std::filesystem::exists(ToPath(path), ec));
  } catch (...) {
    result.Resolve(false);
  }
}

void NoteHarborFileSystem::mkdir(std::string &&path, ::React::ReactPromise<void> &&result) noexcept {
  try {
    std::error_code ec;
    std::filesystem::create_directories(ToPath(path), ec);
    if (ec) {
      result.Reject("Unable to create directory.");
      return;
    }
    result.Resolve();
  } catch (...) {
    result.Reject("Unable to create directory.");
  }
}

void NoteHarborFileSystem::readDir(
    std::string &&path, ::React::ReactPromise<::React::JSValueArray> &&result) noexcept {
  try {
    ::React::JSValueArray entries;
    std::error_code ec;
    for (const auto &entry : std::filesystem::directory_iterator(ToPath(path), ec)) {
      ::React::JSValueObject item{
          {"path", FromPath(entry.path())},
          {"isDirectory", entry.is_directory(ec)},
      };
      entries.push_back(::React::JSValue{std::move(item)});
    }
    if (ec) {
      result.Reject("Unable to read directory.");
      return;
    }
    result.Resolve(std::move(entries));
  } catch (...) {
    result.Reject("Unable to read directory.");
  }
}

void NoteHarborFileSystem::readFile(
    std::string &&path, std::string &&encoding, ::React::ReactPromise<std::string> &&result) noexcept {
  try {
    bool ok = false;
    auto bytes = ReadAllBytes(ToPath(path), ok);
    if (!ok) {
      result.Reject("Unable to read file.");
      return;
    }
    if (encoding == "base64") {
      const auto encoded = Base64Encode(bytes);
      if (encoded.empty() && !bytes.empty()) {
        result.Reject("Unable to encode file contents.");
        return;
      }
      result.Resolve(encoded);
      return;
    }
    result.Resolve(std::string(reinterpret_cast<const char *>(bytes.data()), bytes.size()));
  } catch (...) {
    result.Reject("Unable to read file.");
  }
}

void NoteHarborFileSystem::readFileChunk(
    std::string &&path,
    double offset,
    double length,
    std::string &&encoding,
    ::React::ReactPromise<std::string> &&result) noexcept {
  try {
    if (!(offset >= 0) || !(length > 0)) {
      result.Reject("Invalid file chunk range.");
      return;
    }

    const auto filePath = ToPath(path);
    HANDLE file = ::CreateFileW(filePath.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING,
        FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) {
      result.Reject("Unable to read file chunk.");
      return;
    }

    LARGE_INTEGER fileSize = {};
    if (::GetFileSizeEx(file, &fileSize) == FALSE) {
      ::CloseHandle(file);
      result.Reject("Unable to read file chunk.");
      return;
    }

    long long start = static_cast<long long>(offset);
    long long want = static_cast<long long>(length);
    if (start >= fileSize.QuadPart) {
      ::CloseHandle(file);
      result.Resolve(std::string{});
      return;
    }

    long long available = fileSize.QuadPart - start;
    long long count = want < available ? want : available;

    LARGE_INTEGER position = {};
    position.QuadPart = start;
    if (::SetFilePointerEx(file, position, nullptr, FILE_BEGIN) == FALSE) {
      ::CloseHandle(file);
      result.Reject("Unable to read file chunk.");
      return;
    }

    std::vector<uint8_t> bytes(static_cast<size_t>(count));
    size_t bytesRead = 0;
    while (bytesRead < bytes.size()) {
      DWORD chunk = 0;
      const size_t remaining = bytes.size() - bytesRead;
      const DWORD request = remaining > MAXDWORD ? MAXDWORD : static_cast<DWORD>(remaining);
      if (::ReadFile(file, bytes.data() + bytesRead, request, &chunk, nullptr) == FALSE || chunk == 0) {
        ::CloseHandle(file);
        result.Reject("Unable to read file chunk.");
        return;
      }
      bytesRead += chunk;
    }
    ::CloseHandle(file);

    if (encoding == "base64") {
      const auto encoded = Base64Encode(bytes);
      if (encoded.empty() && !bytes.empty()) {
        result.Reject("Unable to encode file chunk.");
        return;
      }
      result.Resolve(encoded);
      return;
    }
    result.Resolve(std::string(reinterpret_cast<const char *>(bytes.data()), bytes.size()));
  } catch (...) {
    result.Reject("Unable to read file chunk.");
  }
}

void NoteHarborFileSystem::extractArchive(
    std::string &&archivePath,
    std::string &&destDir,
    ::React::ReactPromise<void> &&result) noexcept {
  try {
    // Quote injection guard: tar.exe receives one pre-quoted command line.
    if (archivePath.find('"') != std::string::npos || destDir.find('"') != std::string::npos) {
      result.Reject("Archive path is not supported.");
      return;
    }

    const auto archive = ToPath(archivePath);
    // Packaged runs redirect %LOCALAPPDATA% writes into the package
    // LocalCache backing store, but the spawned tar.exe resolves the
    // literal path — aim it at the backing store so both sides meet.
    const auto dest = ToBackingStorePath(ToPath(destDir));

    std::error_code ec;
    std::filesystem::create_directories(dest, ec);
    if (!std::filesystem::is_directory(dest, ec)) {
      result.Reject("Unable to prepare the extraction directory.");
      return;
    }

    wchar_t systemDir[MAX_PATH] = {};
    if (::GetSystemDirectoryW(systemDir, ARRAYSIZE(systemDir)) == 0) {
      result.Reject("Archive extraction is not available on this system.");
      return;
    }
    const auto tarExe = std::filesystem::path(systemDir) / L"tar.exe";
    if (!std::filesystem::exists(tarExe, ec)) {
      result.Reject("Archive extraction is not available (tar.exe not found).");
      return;
    }

    std::wstring command = L"\"" + tarExe.wstring() + L"\" -xf " +
        QuoteNativeArg(archive.wstring()) + L" -C " + QuoteNativeArg(dest.wstring());

    // Capture the child's stderr so failures carry tar's own message.
    SECURITY_ATTRIBUTES inheritable{};
    inheritable.nLength = static_cast<DWORD>(sizeof(SECURITY_ATTRIBUTES));
    inheritable.bInheritHandle = TRUE;
    HANDLE errorRead = nullptr;
    HANDLE errorWrite = nullptr;
    if (::CreatePipe(&errorRead, &errorWrite, &inheritable, 0) != FALSE) {
      ::SetHandleInformation(errorRead, HANDLE_FLAG_INHERIT, 0);
    } else {
      errorRead = nullptr;
      errorWrite = nullptr;
    }

    HANDLE nulInput =
        ::CreateFileW(L"NUL", GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING, 0, nullptr);

    STARTUPINFOW startup{};
    startup.cb = static_cast<DWORD>(sizeof(startup));
    PROCESS_INFORMATION processInfo{};
    bool launched = false;
    if (errorWrite != nullptr && nulInput != INVALID_HANDLE_VALUE) {
      startup.dwFlags = STARTF_USESTDHANDLES;
      startup.hStdInput = nulInput;
      startup.hStdOutput = errorWrite;
      startup.hStdError = errorWrite;
      launched = ::CreateProcessW(nullptr, command.data(), nullptr, nullptr, TRUE, CREATE_NO_WINDOW,
                       nullptr, nullptr, &startup, &processInfo) == TRUE;
    } else {
      // No redirection: inherit nothing extra, no console window.
      launched = ::CreateProcessW(nullptr, command.data(), nullptr, nullptr, FALSE, CREATE_NO_WINDOW,
                       nullptr, nullptr, &startup, &processInfo) == TRUE;
    }

    if (errorWrite != nullptr) {
      ::CloseHandle(errorWrite);
    }
    if (nulInput != INVALID_HANDLE_VALUE) {
      ::CloseHandle(nulInput);
    }

    if (!launched) {
      if (errorRead != nullptr) {
        ::CloseHandle(errorRead);
      }
      result.Reject("Unable to extract archive.");
      return;
    }

    constexpr DWORD kTimeoutMs = 20 * 60 * 1000;
    const DWORD waitResult = ::WaitForSingleObject(processInfo.hProcess, kTimeoutMs);

    std::string childErrors;
    if (errorRead != nullptr) {
      char buffer[4096];
      for (;;) {
        DWORD available = 0;
        if (::PeekNamedPipe(errorRead, nullptr, 0, nullptr, &available, nullptr) == FALSE || available == 0) {
          break;
        }
        DWORD chunk = 0;
        if (::ReadFile(errorRead, buffer, sizeof(buffer), &chunk, nullptr) == FALSE || chunk == 0) {
          break;
        }
        if (childErrors.size() < 2048) {
          childErrors.append(buffer, chunk);
        }
      }
      ::CloseHandle(errorRead);
    }

    DWORD exitCode = 1;
    if (waitResult == WAIT_TIMEOUT) {
      ::TerminateProcess(processInfo.hProcess, 1);
      ::CloseHandle(processInfo.hThread);
      ::CloseHandle(processInfo.hProcess);
      result.Reject("Archive extraction timed out.");
      return;
    }
    if (::GetExitCodeProcess(processInfo.hProcess, &exitCode) == FALSE) {
      exitCode = 1;
    }
    ::CloseHandle(processInfo.hThread);
    ::CloseHandle(processInfo.hProcess);

    if (waitResult != WAIT_OBJECT_0 || exitCode != 0) {
      std::string message =
          "Unable to extract archive (tar exited " + std::to_string(exitCode) + ").";
      const auto detail = TrimAscii(childErrors);
      if (!detail.empty()) {
        message += " " + detail.substr(0, 1024);
      }
      result.Reject(message.c_str());
      return;
    }

    result.Resolve();
  } catch (...) {
    result.Reject("Unable to extract archive.");
  }
}

void NoteHarborFileSystem::writeFile(
    std::string &&path,
    std::string &&contents,
    std::string &&encoding,
    ::React::ReactPromise<void> &&result) noexcept {
  try {
    const auto target = ToPath(path);
    bool ok = false;
    if (encoding == "base64") {
      auto bytes = Base64Decode(contents, ok);
      if (!ok) {
        result.Reject("Unable to write file.");
        return;
      }
      ok = WriteAllBytes(target, bytes.data(), bytes.size());
    } else {
      ok = WriteAllBytes(
          target, reinterpret_cast<const uint8_t *>(contents.data()), contents.size());
    }
    if (!ok) {
      result.Reject("Unable to write file.");
      return;
    }
    result.Resolve();
  } catch (...) {
    result.Reject("Unable to write file.");
  }
}

void NoteHarborFileSystem::unlink(std::string &&path, ::React::ReactPromise<void> &&result) noexcept {
  try {
    std::error_code ec;
    std::filesystem::remove_all(ToPath(path), ec);
    result.Resolve();
  } catch (...) {
    result.Reject("Unable to delete path.");
  }
}

void NoteHarborFileSystem::moveFile(
    std::string &&src, std::string &&dest, ::React::ReactPromise<void> &&result) noexcept {
  try {
    const auto srcPath = ToPath(src);
    const auto destPath = ToPath(dest);
    std::error_code ec;
    std::filesystem::create_directories(destPath.parent_path(), ec);
    std::filesystem::rename(srcPath, destPath, ec);
    if (ec) {
      std::filesystem::copy_file(srcPath, destPath, std::filesystem::copy_options::overwrite_existing, ec);
      if (ec) {
        result.Reject("Unable to move file.");
        return;
      }
      std::filesystem::remove_all(srcPath, ec);
    }
    result.Resolve();
  } catch (...) {
    result.Reject("Unable to move file.");
  }
}

std::string NoteHarborFileSystem::getDocumentDirectoryPath() noexcept {
  // Synchronous accessor so JavaScript never depends on constant export
  // timing; recomputed on each call (cheap: no I/O beyond ensuring the
  // directory exists).
  return GetDefaultDocumentDirectoryPath();
}

int64_t NoteHarborFileSystem::getFileSize(std::string &&path) noexcept {
  try {
    std::error_code ec;
    const auto size = std::filesystem::file_size(ToPath(path), ec);
    if (ec || size == static_cast<decltype(size)>(-1)) {
      return -1;
    }
    return static_cast<int64_t>(size);
  } catch (...) {
    return -1;
  }
}

} // namespace ViewerReactNative
