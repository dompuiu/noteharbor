#import "AppDelegate.h"

#import <React/RCTBundleURLProvider.h>
#import <ReactAppDependencyProvider/RCTAppDependencyProvider.h>

@implementation AppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)notification
{
  self.moduleName = @"viewer_react_native";
  // You can add your custom initial props in the dictionary below.
  // They will be passed down to the ViewController used by React Native.
  self.initialProps = @{};
  self.dependencyProvider = [RCTAppDependencyProvider new];

  [super applicationDidFinishLaunching:notification];

  [self restoreViewerMainWindowBounds];
}

#pragma mark - Viewer window size persistence

// First run defaults to 1000x700 (matches Windows; fits 768p laptop screens).
// Afterwards the last size/position is restored via the window's autosave name
// (backed by NSUserDefaults), so the Viewer reopens where the user left it.
- (void)restoreViewerMainWindowBounds
{
  static NSString *const kViewerWindowFrameName = @"ViewerMainWindow";
  static const CGFloat kViewerDefaultWidth = 1000.0;
  static const CGFloat kViewerDefaultHeight = 700.0;
  static const CGFloat kViewerMinWidth = 640.0;
  static const CGFloat kViewerMinHeight = 480.0;

  NSWindow *window = NSApp.mainWindow;
  if (window == nil) {
    window = NSApp.windows.firstObject;
  }
  if (window == nil) {
    return;
  }

  window.frameAutosaveName = kViewerWindowFrameName;
  window.minSize = NSMakeSize(kViewerMinWidth, kViewerMinHeight);

  BOOL restored = [window setFrameUsingName:kViewerWindowFrameName force:NO];
  if (!restored) {
    [window setContentSize:NSMakeSize(kViewerDefaultWidth, kViewerDefaultHeight)];
    [window center];
  } else if (window.screen != nil) {
    // A saved frame from a disconnected monitor can strand the window
    // off-screen; re-center instead of leaving it unreachable.
    NSRect visible = window.screen.visibleFrame;
    if (!NSIsEmptyRect(visible) && !NSIntersectsRect(window.frame, visible)) {
      [window center];
    }
  }
}

- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
  return [self bundleURL];
}

- (NSURL *)bundleURL
{
#if DEBUG
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index"];
#else
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}

/// This method controls whether the `concurrentRoot`feature of React18 is turned on or off.
///
/// @see: https://reactjs.org/blog/2022/03/29/react-v18.html
/// @note: This requires to be rendering on Fabric (i.e. on the New Architecture).
/// @return: `true` if the `concurrentRoot` feature is enabled. Otherwise, it returns `false`.
- (BOOL)concurrentRootEnabled
{
#ifdef RN_FABRIC_ENABLED
  return true;
#else
  return false;
#endif
}

@end
