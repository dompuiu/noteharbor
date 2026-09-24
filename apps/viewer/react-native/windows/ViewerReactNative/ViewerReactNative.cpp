// ViewerReactNative.cpp : Defines the entry point for the application.
//

#include "pch.h"
#include "ViewerReactNative.h"

#include "AutolinkedNativeModules.g.h"

#include "NativeModules.h"
#include "NoteHarborFileSystem.h"

#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <string>

// A PackageProvider containing any turbo modules you define within this app project
struct CompReactPackageProvider
    : winrt::implements<CompReactPackageProvider, winrt::Microsoft::ReactNative::IReactPackageProvider> {
 public: // IReactPackageProvider
  void CreatePackage(winrt::Microsoft::ReactNative::IReactPackageBuilder const &packageBuilder) noexcept {
    AddAttributedModules(packageBuilder, true);
  }
};

namespace {

// Persists the desktop window bounds so the Viewer reopens at the last size
// (and position). Stored next to the imported dataset:
// %LOCALAPPDATA%\ViewerReactNative\window.json
// {"width":1000,"height":700,"x":120,"y":120}
constexpr int kDefaultWidth = 1000;
constexpr int kDefaultHeight = 700;
constexpr int kMinWidth = 640;
constexpr int kMinHeight = 480;
constexpr int kMaxWidth = 3840;
constexpr int kMaxHeight = 2160;

struct SavedWindowBounds {
  int width = 0;
  int height = 0;
  int x = 0;
  int y = 0;
  bool hasPosition = false;
};

std::wstring Utf8ToWidePath(const std::string &value) noexcept {
  try {
    if (value.empty()) {
      return {};
    }
    const int size = ::MultiByteToWideChar(
        CP_UTF8, 0, value.c_str(), static_cast<int>(value.size()), nullptr, 0);
    if (size <= 0) {
      return {};
    }
    std::wstring result(static_cast<size_t>(size), L'\0');
    ::MultiByteToWideChar(CP_UTF8, 0, value.c_str(), static_cast<int>(value.size()), result.data(), size);
    return result;
  } catch (...) {
    return {};
  }
}

std::filesystem::path ViewerWindowBoundsPath() noexcept {
  try {
    const std::string dir = ViewerReactNative::NoteHarborFileSystem::GetDefaultDocumentDirectoryPath();
    if (dir.empty()) {
      return {};
    }
    std::wstring wide = Utf8ToWidePath(dir);
    if (wide.empty()) {
      return {};
    }
    return std::filesystem::path(wide) / L"window.json";
  } catch (...) {
    return {};
  }
}

bool ParseBoundsField(const std::string &json, const char *key, long &out) noexcept {
  try {
    const std::string quoted = std::string("\"") + key + "\"";
    const size_t pos = json.find(quoted);
    if (pos == std::string::npos) {
      return false;
    }
    const size_t colon = json.find(':', pos + quoted.size());
    if (colon == std::string::npos) {
      return false;
    }
    const char *start = json.c_str() + colon + 1;
    char *end = nullptr;
    const long value = std::strtol(start, &end, 10);
    if (end == start) {
      return false;
    }
    out = value;
    return true;
  } catch (...) {
    return false;
  }
}

int ClampInt(int value, int lo, int hi) noexcept {
  if (value < lo) {
    return lo;
  }
  if (value > hi) {
    return hi;
  }
  return value;
}

bool BoundsOverlapVirtualScreen(int x, int y, int w, int h) noexcept {
  const int vx = ::GetSystemMetrics(SM_XVIRTUALSCREEN);
  const int vy = ::GetSystemMetrics(SM_YVIRTUALSCREEN);
  const int vw = ::GetSystemMetrics(SM_CXVIRTUALSCREEN);
  const int vh = ::GetSystemMetrics(SM_CYVIRTUALSCREEN);
  if (vw <= 0 || vh <= 0) {
    return true;
  }
  return x < vx + vw && y < vy + vh && x + w > vx && y + h > vy;
}

bool TryLoadViewerWindowBounds(SavedWindowBounds &out) noexcept {
  try {
    const auto path = ViewerWindowBoundsPath();
    if (path.empty()) {
      return false;
    }
    std::error_code ec;
    const auto size = std::filesystem::file_size(path, ec);
    if (ec || size == 0 || size > 4096) {
      return false;
    }
    std::ifstream file(path, std::ios::binary);
    if (!file) {
      return false;
    }
    std::string json(static_cast<size_t>(size), '\0');
    file.read(json.data(), static_cast<std::streamsize>(json.size()));
    json.resize(static_cast<size_t>(file.gcount()));
    long width = 0;
    long height = 0;
    if (!ParseBoundsField(json, "width", width) || !ParseBoundsField(json, "height", height)) {
      return false;
    }
    if (width < kMinWidth || width > kMaxWidth || height < kMinHeight || height > kMaxHeight) {
      return false;
    }
    out.width = static_cast<int>(width);
    out.height = static_cast<int>(height);
    long x = 0;
    long y = 0;
    if (ParseBoundsField(json, "x", x) && ParseBoundsField(json, "y", y)) {
      out.x = ClampInt(static_cast<int>(x), -10000, 10000);
      out.y = ClampInt(static_cast<int>(y), -10000, 10000);
      out.hasPosition = true;
    } else {
      out.hasPosition = false;
    }
    return true;
  } catch (...) {
    return false;
  }
}

void SaveViewerWindowBounds(const winrt::Microsoft::UI::Windowing::AppWindow &appWindow) noexcept {
  try {
    const auto path = ViewerWindowBoundsPath();
    if (path.empty()) {
      return;
    }
    const auto size = appWindow.Size();
    const auto position = appWindow.Position();
    const int width = ClampInt(size.Width, kMinWidth, kMaxWidth);
    const int height = ClampInt(size.Height, kMinHeight, kMaxHeight);
    std::error_code ec;
    std::filesystem::create_directories(path.parent_path(), ec);
    const std::string payload = std::string("{\"width\":") + std::to_string(width) + ",\"height\":" +
        std::to_string(height) + ",\"x\":" + std::to_string(position.X) + ",\"y\":" +
        std::to_string(position.Y) + "}";
    const auto tmpPath = std::filesystem::path(path.wstring() + L".tmp");
    {
      std::ofstream file(tmpPath, std::ios::binary | std::ios::trunc);
      if (!file) {
        return;
      }
      file.write(payload.data(), static_cast<std::streamsize>(payload.size()));
      file.flush();
      if (!file) {
        return;
      }
    }
    std::filesystem::rename(tmpPath, path, ec);
    if (ec) {
      // Fallback for cross-volume/AV edge cases: overwrite directly.
      std::ofstream file(path, std::ios::binary | std::ios::trunc);
      if (file) {
        file.write(payload.data(), static_cast<std::streamsize>(payload.size()));
      }
      std::filesystem::remove(tmpPath, ec);
    }
  } catch (...) {
  }
}

void RestoreViewerWindowBounds(const winrt::Microsoft::UI::Windowing::AppWindow &appWindow) noexcept {
  try {
    SavedWindowBounds saved;
    if (!TryLoadViewerWindowBounds(saved)) {
      appWindow.Resize({kDefaultWidth, kDefaultHeight});
      return;
    }
    appWindow.Resize({saved.width, saved.height});
    if (saved.hasPosition &&
        BoundsOverlapVirtualScreen(saved.x, saved.y, saved.width, saved.height)) {
      appWindow.Move({saved.x, saved.y});
    }
  } catch (...) {
    try {
      appWindow.Resize({kDefaultWidth, kDefaultHeight});
    } catch (...) {
    }
  }
}

void TrackViewerWindowBounds(const winrt::Microsoft::UI::Windowing::AppWindow &appWindow) noexcept {
  try {
    // Persist on every committed move/resize plus a final save on close, so
    // the next launch restores the last bounds even after a crash.
    const winrt::event_token changedToken = appWindow.Changed(
        [](const winrt::Microsoft::UI::Windowing::AppWindow &window,
           const winrt::Microsoft::UI::Windowing::AppWindowChangedEventArgs &args) {
          try {
            if (args.DidSizeChange() || args.DidPositionChange()) {
              SaveViewerWindowBounds(window);
            }
          } catch (...) {
          }
        });
    const winrt::event_token destroyingToken = appWindow.Destroying(
        [](const winrt::Microsoft::UI::Windowing::AppWindow &window,
           const winrt::Windows::Foundation::IInspectable &) { SaveViewerWindowBounds(window); });
    (void)changedToken;
    (void)destroyingToken;
  } catch (...) {
  }
}

} // namespace

// The entry point of the Win32 application
_Use_decl_annotations_ int CALLBACK WinMain(HINSTANCE instance, HINSTANCE, PSTR /* commandLine */, int showCmd) {
  // Initialize WinRT
  winrt::init_apartment(winrt::apartment_type::single_threaded);

  // Enable per monitor DPI scaling
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);

  // Find the path hosting the app exe file
  WCHAR appDirectory[MAX_PATH];
  GetModuleFileNameW(NULL, appDirectory, MAX_PATH);
  PathCchRemoveFileSpec(appDirectory, MAX_PATH);

  // Create a ReactNativeWin32App with the ReactNativeAppBuilder
  auto reactNativeWin32App{winrt::Microsoft::ReactNative::ReactNativeAppBuilder().Build()};

  // Configure the initial InstanceSettings for the app's ReactNativeHost
  auto settings{reactNativeWin32App.ReactNativeHost().InstanceSettings()};
  // Register any autolinked native modules
  RegisterAutolinkedNativeModulePackages(settings.PackageProviders());
  // Register any native modules defined within this app project
  settings.PackageProviders().Append(winrt::make<CompReactPackageProvider>());

    // When loading the JS bundle from a file (not Metro):
  // Set the path (on disk) where the .bundle file is located
  settings.BundleRootPath(std::wstring(L"file://").append(appDirectory).append(L"\\Bundle\\").c_str());

  // Set the name of the bundle file (without the .bundle extension)
  settings.JavaScriptBundleFile(L"index.windows");

  // JS Entry file to use when loading from Metro:
  settings.DebugBundlePath(L"index");

#if BUNDLE
  // Disable hot reload - bundle will be loaded from prebuilt bundle file.
  settings.UseFastRefresh(false);
#else
  // Enable hot reload - load the JS bundle from Metro
  settings.UseFastRefresh(true);
#endif
#if _DEBUG
  // For Debug builds
  // Enable Direct Debugging of JS
  settings.UseDirectDebugger(true);
  // Enable the Developer Menu
  settings.UseDeveloperSupport(true);
#else
  // For Release builds:
  // Disable Direct Debugging of JS
  settings.UseDirectDebugger(false);
  // Disable the Developer Menu
  settings.UseDeveloperSupport(false);
#endif

  // Get the AppWindow so we can configure its initial title and size
  auto appWindow{reactNativeWin32App.AppWindow()};
  appWindow.Title(L"ViewerReactNative");
  // First run defaults to 1000x700 (fits 768p laptop screens; Modals size
  // to the window, so starting taller strands the title bar). Afterwards the
  // last size/position is restored from
  // %LOCALAPPDATA%\ViewerReactNative\window.json.
  RestoreViewerWindowBounds(appWindow);
  TrackViewerWindowBounds(appWindow);

  // Get the ReactViewOptions so we can set the initial RN component to load
  auto viewOptions{reactNativeWin32App.ReactViewOptions()};
  viewOptions.ComponentName(L"ViewerReactNative");

  // Start the app
  reactNativeWin32App.Start();
}
