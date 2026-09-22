#include "pch.h"

#include "NoteHarborArchivePicker.h"

#include <commdlg.h>
#include <string>

using namespace winrt::Microsoft::ReactNative;

namespace {

std::string WideToUtf8(const std::wstring &value) {
  if (value.empty()) {
    return {};
  }
  const int size = ::WideCharToMultiByte(
      CP_UTF8, 0, value.c_str(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
  std::string result(static_cast<size_t>(size), '\0');
  ::WideCharToMultiByte(
      CP_UTF8, 0, value.c_str(), static_cast<int>(value.size()), result.data(), size, nullptr, nullptr);
  return result;
}

std::wstring FileNameOf(const std::wstring &path) {
  const size_t slash = path.find_last_of(L"/\\");
  return slash == std::wstring::npos ? path : path.substr(slash + 1);
}

} // namespace

namespace ViewerReactNative {

void NoteHarborArchivePicker::pickArchiveFile(::React::ReactPromise<::React::JSValue> &&result) noexcept {
  try {
    wchar_t fileBuffer[32768] = {};
    OPENFILENAMEW dialog = {};
    dialog.lStructSize = sizeof(dialog);
    dialog.hwndOwner = ::GetForegroundWindow();
    dialog.lpstrFile = fileBuffer;
    dialog.nMaxFile = ARRAYSIZE(fileBuffer);
    dialog.lpstrFilter = L"Note Harbor archive (*.zip)\0*.zip\0All files (*.*)\0*.*\0";
    dialog.nFilterIndex = 1;
    dialog.lpstrTitle = L"Choose Note Harbor archive";
    dialog.Flags = OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR;
    dialog.lpstrDefExt = L"zip";

    if (::GetOpenFileNameW(&dialog) != TRUE) {
      const DWORD error = ::CommDlgExtendedError();
      if (error == 0) {
        result.Resolve(::React::JSValue{});
        return;
      }
      result.Reject("Windows archive picker failed.");
      return;
    }

    const std::wstring pickedPath(fileBuffer);
    const std::string archivePath = WideToUtf8(pickedPath);
    const std::string name = WideToUtf8(FileNameOf(pickedPath));
    ::React::JSValueObject location{
        {"archivePath", archivePath},
        {"name", name},
    };
    result.Resolve(::React::JSValue{std::move(location)});
  } catch (...) {
    result.Reject("Windows archive picker failed.");
  }
}

} // namespace ViewerReactNative
