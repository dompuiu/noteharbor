// Speculative image loading for the Note slideshow and Image popover.
//
// Every managed image URL the editor builds is versioned with the note's
// `updated_at`, so a URL's bytes never change. A speculative load therefore
// only has to happen once per URL; the browser's HTTP cache serves every later
// paint. A small bounded set of `Image` objects is kept alive so the decoded
// frame survives too, and speculative loads are marked low priority so they
// never compete with the image the collector is looking at.
import { useEffect } from "react";

// Full-size plate scans run to several megabytes, and a decoded frame is much
// larger than the file. Thumbnails are tiny by comparison, so the two sizes
// get their own budgets: a walk over slides can hold a window of thumbnails
// without evicting the full plate the popover is about to show.
const CACHE_LIMITS = { full: 4, thumbnail: 8 };

const preloadedImages = {
  full: new Map(),
  thumbnail: new Map(),
};

function cacheFor(kind) {
  return kind === "thumbnail" ? preloadedImages.thumbnail : preloadedImages.full;
}

function rememberImage(src, image, kind) {
  const cache = cacheFor(kind);

  // Re-inserting moves the URL to the young end of the LRU.
  cache.delete(src);
  cache.set(src, image);

  while (cache.size > CACHE_LIMITS[kind]) {
    const oldestSrc = cache.keys().next().value;
    // Dropping the reference lets the browser reclaim the decoded frame.
    // Clearing `src` would risk firing another request for the current page.
    cache.delete(oldestSrc);
  }
}

function decodeInBackground(image) {
  if (typeof image?.decode === "function") {
    image.decode().catch(() => {});
  }
}

function preloadImage(
  src,
  { cache = "full", decode = false, priority = "low" } = {},
) {
  if (!src || typeof src !== "string" || typeof Image === "undefined") {
    return null;
  }

  const kind = cache === "thumbnail" ? "thumbnail" : "full";
  const images = cacheFor(kind);
  const cached = images.get(src);

  if (cached) {
    rememberImage(src, cached, kind);

    if (decode) {
      decodeInBackground(cached);
    }

    return cached;
  }

  const image = new Image();
  image.decoding = "async";

  if ("fetchPriority" in image) {
    image.fetchPriority = priority;
  }

  // A failed speculative load must not poison the cache: drop it so a later
  // open retries instead of reusing a dead image element.
  image.onerror = () => {
    if (images.get(src) === image) {
      images.delete(src);
    }
  };

  image.src = src;
  rememberImage(src, image, kind);

  if (decode) {
    decodeInBackground(image);
  }

  return image;
}

function preloadImages(srcs, options) {
  (srcs ?? []).forEach((src) => preloadImage(src, options));
}

// The live element for an already-warmed URL, so a caller can skip a second
// probe and decode when the frame is ready to paint.
function getPreloadedImage(src, { cache = "full" } = {}) {
  if (!src || typeof src !== "string") {
    return null;
  }

  const kind = cache === "thumbnail" ? "thumbnail" : "full";
  const images = cacheFor(kind);
  const image = images.get(src);

  if (image) {
    rememberImage(src, image, kind);
  }

  return image ?? null;
}

// The previous/next sources in a wrapping image sequence, skipping a
// neighbour that is the same image as the open one (a note with only one
// side) and any missing source.
function neighbouringImageSources(items, index) {
  if (!Array.isArray(items) || items.length < 2 || index < 0) {
    return [];
  }

  const count = items.length;
  const current = items[index];
  const sources = [];

  [1, -1].forEach((offset) => {
    const neighbour = items[(index + offset + count) % count];

    if (neighbour?.src && neighbour.src !== current?.src) {
      sources.push(neighbour.src);
    }
  });

  return sources;
}

// Preloads a changing set of URLs after the current paint. A non-zero `delay`
// waits that long before asking for an idle slot, so a held arrow key does not
// queue a fetch for every note it skips past.
function useImagePreload(
  srcs,
  { cache = "full", decode = false, delay = 0, priority = "low" } = {},
) {
  const urls = (srcs ?? []).filter(
    (src) => typeof src === "string" && src.length > 0,
  );
  // The callers build fresh arrays each render; the joined key is what tells
  // the effect whether the set actually changed.
  const key = urls.join("\n");

  useEffect(() => {
    if (!key) {
      return undefined;
    }

    let cancelled = false;
    let idleHandle = null;
    let timer = null;
    const run = () => {
      if (!cancelled) {
        preloadImages(urls, { cache, decode, priority });
      }
    };
    const runWhenIdle = () => {
      if (cancelled) {
        return;
      }

      if (typeof requestIdleCallback === "function") {
        idleHandle = requestIdleCallback(run, { timeout: 500 });
      } else {
        timer = setTimeout(run, 0);
      }
    };

    if (delay > 0) {
      timer = setTimeout(runWhenIdle, delay);
    } else {
      runWhenIdle();
    }

    return () => {
      cancelled = true;

      if (idleHandle != null) {
        cancelIdleCallback(idleHandle);
      }

      if (timer != null) {
        clearTimeout(timer);
      }
    };
  }, [cache, decode, delay, key, priority]);
}

export {
  getPreloadedImage,
  neighbouringImageSources,
  preloadImage,
  preloadImages,
  useImagePreload,
};
